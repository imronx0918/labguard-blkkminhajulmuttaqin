#!/usr/bin/env python3
"""LAB GATEWAY AGENT — LABGUARD EDU

Perintah:
  init-config --server URL --out PATH      Buat file konfigurasi awal
  pair --code XXXXX-XXXXX                  Pairing dengan kode sekali pakai dari dashboard
  run                                      Loop utama (heartbeat, sinkronisasi kebijakan, kirim log)
  sync-once                                Ambil & terapkan kebijakan sekali (sesuai mode server)
  validate                                 Dry-run: render + uji sintaks bundle saat ini, tanpa mengubah jaringan
  rollback                                 Pulihkan konfigurasi dari backup terakhir
  status                                   Tampilkan status lokal

Operasi jarak jauh dari dashboard HANYA: APPLY_POLICY, RELOAD_FILTERING, CHECK_STATUS, ROLLBACK,
SYNC_CONFIGURATION, BACKUP_CONFIGURATION. Tidak ada eksekusi perintah shell bebas.
Saat server tidak dapat dihubungi, kebijakan terakhir yang valid TETAP berlaku (tidak ada fail-open).
"""
import argparse
import glob
import json
import logging
import os
import signal
import socket
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent.client import ApiClient, ApiError  # noqa: E402
from agent.config import AgentConfig  # noqa: E402
from agent.logwatch import DnsLogParser, Tail, build_category_lookup, parse_kernel  # noqa: E402
from agent.renderers import protections  # noqa: E402
from agent.state import State  # noqa: E402
from agent.validate import BundleError, validate_bundle  # noqa: E402
from adapters.base import ApplyError  # noqa: E402

AGENT_VERSION = "1.0.0"
ALLOWED_COMMANDS = {"APPLY_POLICY", "RELOAD_FILTERING", "CHECK_STATUS", "ROLLBACK", "SYNC_CONFIGURATION", "BACKUP_CONFIGURATION"}
log = logging.getLogger("labguard-agent")


def make_adapter(cfg: AgentConfig, runner=None, resolver=None):
    if cfg.adapter == "linux-nftables-dnsmasq":
        from adapters.linux_nftables_dnsmasq import LinuxNftablesDnsmasqAdapter
        kw = {"runner": runner}
        if resolver:
            kw["resolver"] = resolver
        return LinuxNftablesDnsmasqAdapter(cfg, **kw)
    if cfg.adapter == "mikrotik-routeros-rest":
        from adapters.mikrotik import MikrotikRestAdapter
        return MikrotikRestAdapter(cfg)
    raise ValueError(f"Adapter tidak dikenal: {cfg.adapter}")


def local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return ""


def arp_clients(iface: str) -> list:
    out = []
    try:
        with open("/proc/net/arp") as f:
            for ln in f.readlines()[1:]:
                parts = ln.split()
                if len(parts) >= 6 and parts[5] == iface and parts[3] != "00:00:00:00:00:00":
                    out.append({"ip": parts[0], "mac": parts[3]})
    except FileNotFoundError:
        pass
    return out[:1000]


class Agent:
    def __init__(self, cfg: AgentConfig, client: ApiClient = None, adapter=None, state: State = None):
        self.cfg = cfg
        self.state = state or State(cfg.state_dir)
        self.client = client or ApiClient(cfg.server_url, cfg.verify_tls, cfg.ca_bundle)
        creds = self.state.credentials()
        if creds:
            self.client.set_credentials(creds["gateway_id"], creds["secret"])
        self.adapter = adapter or make_adapter(cfg)
        self.events: list = []
        self.completed: list = []
        self.parsers = {}
        self.kern_tail = Tail(cfg.kern_log_path)
        self.interval = 30
        self.started = time.time()
        self.last_bundle = self.state.last_good_bundle()
        self._stop = False

    # ------------------------------------------------------------ pairing
    def pair(self, code: str) -> str:
        r = self.client.pair(code.strip().upper(), socket.gethostname(), AGENT_VERSION, local_ip())
        self.state.save_credentials(r["gatewayId"], r["secret"])
        self.client.set_credentials(r["gatewayId"], r["secret"])
        return r["gatewayId"]

    # ------------------------------------------------------------ policy sync
    def sync(self, force: bool = False) -> dict:
        bundle = self.client.current_policy()
        try:
            validate_bundle(bundle)
        except (BundleError, ValueError) as e:
            self.client.apply_result({"deploymentId": bundle.get("deploymentId"), "version": int(bundle.get("version") or 0), "bundleHash": str(bundle.get("hash", ""))[:80], "success": False, "rolledBack": False, "error": f"Bundle ditolak validasi agent: {e}", "checks": []})
            raise
        applied = self.state.applied()
        validated = self.state.validated()
        live = bundle["mode"] == "LIVE" and self.cfg.allow_network_changes
        if not force and ((live and applied.get("hash") == bundle["hash"]) or (not live and validated.get("hash") == bundle["hash"])):
            return {"status": "UNCHANGED", "version": bundle["version"]}
        t0 = time.time()
        if not live:
            # MODE DEMO / allow_network_changes=false: render + uji sintaks saja, TANPA mengubah jaringan.
            try:
                checks = self.adapter.validate(bundle)
                ok = all(c["passed"] for c in checks)
                err = None if ok else "Validasi dry-run gagal"
            except ApplyError as e:
                checks, ok, err = e.checks, False, str(e)
            self.client.apply_result({"deploymentId": bundle.get("deploymentId"), "version": bundle["version"], "bundleHash": bundle["hash"], "success": ok, "rolledBack": False, "error": err, "checks": checks, "durationMs": int((time.time() - t0) * 1000)})
            if ok:
                self.state.save_validated(bundle["version"], bundle["hash"])
            return {"status": "VALIDATED" if ok else "INVALID", "version": bundle["version"]}
        try:
            checks = self.adapter.apply(bundle)
            self.state.save_applied(bundle["version"], bundle["hash"], bundle)
            self.last_bundle = bundle
            self._upload_backup("pre-apply", applied.get("version"))
            self.client.apply_result({"deploymentId": bundle.get("deploymentId"), "version": bundle["version"], "bundleHash": bundle["hash"], "success": True, "rolledBack": False, "error": None, "checks": checks, "durationMs": int((time.time() - t0) * 1000)})
            log.info("Kebijakan v%s diterapkan", bundle["version"])
            return {"status": "APPLIED", "version": bundle["version"]}
        except ApplyError as e:
            log.error("Penerapan gagal: %s (rollback=%s)", e, e.rolled_back)
            self.client.apply_result({"deploymentId": bundle.get("deploymentId"), "version": bundle["version"], "bundleHash": bundle["hash"], "success": False, "rolledBack": e.rolled_back, "error": str(e)[:2000], "checks": e.checks[:100], "durationMs": int((time.time() - t0) * 1000)})
            return {"status": "FAILED", "error": str(e)}

    def _upload_backup(self, reason: str, version):
        files = self.adapter.backup_files()
        if files:
            try:
                self.client.backup(reason, version, files)
            except ApiError as e:
                log.warning("Upload backup gagal: %s", e)

    # ------------------------------------------------------------ commands (whitelist)
    def handle_command(self, cmd: dict):
        t = cmd.get("type")
        if t not in ALLOWED_COMMANDS:
            log.warning("Perintah ditolak (tidak di-whitelist): %s", t)
            return
        log.info("Menjalankan perintah %s", t)
        if t in ("APPLY_POLICY", "SYNC_CONFIGURATION"):
            self.sync(force=(t == "APPLY_POLICY"))
        elif t == "RELOAD_FILTERING":
            if self.last_bundle and self.cfg.allow_network_changes and self.last_bundle.get("mode") == "LIVE":
                self.adapter.apply(self.last_bundle)
        elif t == "ROLLBACK":
            try:
                snap = self.adapter.rollback()
                self.state.save_applied(-1, "rolled-back", self.last_bundle or {})
                self.client.apply_result({"deploymentId": None, "version": int(self.state.applied().get("version") or 0), "bundleHash": "rolled-back", "success": False, "rolledBack": True, "error": f"Rollback manual dari dashboard ke snapshot {os.path.basename(snap)}", "checks": []})
            except ApplyError as e:
                log.error("Rollback gagal: %s", e)
        elif t == "BACKUP_CONFIGURATION":
            self._upload_backup("manual", self.state.applied().get("version"))
        # CHECK_STATUS: status dikirim pada heartbeat berikutnya
        self.completed.append(cmd["id"])

    # ------------------------------------------------------------ heartbeat & events
    def heartbeat(self) -> dict:
        st = self.adapter.status()
        applied = self.state.applied()
        payload = {
            "agentVersion": AGENT_VERSION, "localIp": local_ip(), "appliedPolicyVersion": applied.get("version") if isinstance(applied.get("version"), int) and applied.get("version") >= 0 else None,
            "appliedBundleHash": applied.get("hash"), "dns": st["dns"], "firewall": st["firewall"], "filtering": st["filtering"],
            "protections": protections(self.last_bundle, self.cfg) if self.last_bundle else [],
            "clients": arp_clients(self.cfg.lan_interface), "uptimeSec": int(time.time() - self.started), "completedCommandIds": self.completed[-50:],
        }
        r = self.client.heartbeat(payload)
        self.completed = [c for c in self.completed if c not in payload["completedCommandIds"]]
        self.interval = max(10, min(600, int(r.get("heartbeatIntervalSec", 30))))
        for cmd in r.get("commands", []):
            try:
                self.handle_command(cmd)
            except Exception as e:  # noqa: BLE001
                log.error("Perintah %s gagal: %s", cmd.get("type"), e)
        target_hash = r.get("desiredBundleHash")
        state_hash = self.state.applied().get("hash") if r.get("mode") == "LIVE" else self.state.validated().get("hash")
        if target_hash and target_hash != state_hash:
            self.sync()
        return r

    def collect_events(self):
        bundle = self.last_bundle
        if bundle:
            for i, lab in enumerate(bundle.get("labs", [])):
                path = os.path.join(self.cfg.dnsmasq_log_dir, f"dnsmasq-lab-{i}.log")
                if path not in self.parsers:
                    self.parsers[path] = (Tail(path), DnsLogParser(lab["labId"], build_category_lookup(lab["policy"])))
                tail, parser = self.parsers[path]
                self.events += parser.feed(tail.read_new())
        self.events += parse_kernel(self.kern_tail.read_new())

    def flush_events(self):
        while self.events:
            batch, self.events = self.events[:500], self.events[500:]
            try:
                self.client.events(batch)
            except ApiError as e:
                log.warning("Gagal mengirim event (%s); disimpan untuk dicoba lagi", e)
                self.events = (batch + self.events)[:20000]
                return

    def run(self):
        signal.signal(signal.SIGTERM, lambda *_: setattr(self, "_stop", True))
        log.info("LAB GATEWAY AGENT %s mulai. Server: %s", AGENT_VERSION, self.cfg.server_url)
        next_hb = 0.0
        backoff = 5
        while not self._stop:
            now = time.time()
            if now >= next_hb:
                try:
                    self.heartbeat()
                    backoff = 5
                    next_hb = now + self.interval
                except ApiError as e:
                    # Server tidak terjangkau: kebijakan terakhir yang valid tetap aktif (tidak fail-open).
                    log.warning("Heartbeat gagal: %s — mempertahankan kebijakan terakhir. Coba lagi %ss", e, backoff)
                    next_hb = now + backoff
                    backoff = min(backoff * 2, 300)
                except Exception as e:  # noqa: BLE001
                    log.exception("Kesalahan tak terduga: %s", e)
                    next_hb = now + 30
            try:
                self.collect_events()
                self.flush_events()
            except Exception as e:  # noqa: BLE001
                log.warning("Pengumpulan event gagal: %s", e)
            time.sleep(5)


def main(argv=None):
    ap = argparse.ArgumentParser(description="LABGUARD EDU — LAB GATEWAY AGENT")
    ap.add_argument("--config", default="/etc/labguard-agent/agent.json")
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)
    ic = sub.add_parser("init-config")
    ic.add_argument("--server", required=True)
    ic.add_argument("--out", required=True)
    p = sub.add_parser("pair")
    p.add_argument("--code", required=True)
    for c in ("run", "sync-once", "validate", "rollback", "status"):
        sub.add_parser(c)
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if a.cmd == "init-config":
        cfg = AgentConfig(server_url=a.server)
        cfg.validate()
        cfg.save(a.out)
        os.chmod(a.out, 0o600)
        print(f"Konfigurasi ditulis ke {a.out}")
        return 0
    cfg = AgentConfig.load(a.config)
    agent = Agent(cfg)
    if a.cmd == "pair":
        gid = agent.pair(a.code)
        print(f"Pairing berhasil. Gateway ID: {gid}")
    elif a.cmd == "run":
        agent.run()
    elif a.cmd == "sync-once":
        print(json.dumps(agent.sync(force=True), indent=2))
    elif a.cmd == "validate":
        bundle = validate_bundle(agent.client.current_policy())
        print(json.dumps(agent.adapter.validate(bundle), indent=2))
    elif a.cmd == "rollback":
        print("Dipulihkan dari:", agent.adapter.rollback())
    elif a.cmd == "status":
        print(json.dumps({"applied": agent.state.applied(), "validated": agent.state.validated(), "paired": bool(agent.state.credentials()), "adapter": cfg.adapter, "status": agent.adapter.status(), "backups": sorted(glob.glob(os.path.join(cfg.state_dir, "backups", "2*")))[-5:]}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
