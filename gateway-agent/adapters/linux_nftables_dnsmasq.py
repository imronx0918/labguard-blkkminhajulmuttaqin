"""Adapter Linux gateway: nftables (firewall/NAT/anti-bypass) + dnsmasq per lab (DNS filtering)."""
import glob
import os
import shutil
import tempfile
import time
from typing import List

from agent import dnsclient
from agent.config import AgentConfig
from agent.renderers import lab_port, render_dnsmasq, render_nft
from agent.runner import Runner
from .base import ApplyError, NetworkAdapter


def _check(name, layer, target, expected, actual, passed):
    return {"name": name, "layer": layer, "target": target, "expected": expected, "actual": actual, "passed": bool(passed)}


class LinuxNftablesDnsmasqAdapter(NetworkAdapter):
    name = "linux-nftables-dnsmasq"
    verified = True

    def __init__(self, cfg: AgentConfig, runner: Runner = None, resolver=dnsclient.resolve, settle_sec: float = 1.5):
        self.cfg = cfg
        self.runner = runner or Runner()
        self.resolve = resolver
        self.settle = settle_sec
        self.backup_dir = os.path.join(cfg.state_dir, "backups")
        os.makedirs(self.backup_dir, mode=0o700, exist_ok=True)

    # ---------------------------------------------------------------- render
    def _render_all(self, bundle: dict, out_dir: str) -> dict:
        files = {}
        missing = [l["labId"] for l in bundle["labs"] if not l.get("subnet")]
        if missing:
            raise ApplyError(f"Subnet lab belum dikonfigurasi di dashboard: {', '.join(missing)} (BELUM DIKONFIGURASI)")
        if not bundle["labs"]:
            raise ApplyError("Gateway belum ditetapkan ke laboratorium mana pun (BELUM DIKONFIGURASI)")
        for i, lab in enumerate(bundle["labs"]):
            p = os.path.join(out_dir, f"lab-{i}.conf")
            with open(p, "w") as f:
                f.write(render_dnsmasq(self.cfg, lab, i, bundle["version"]))
            files[f"dnsmasq/lab-{i}.conf"] = p
        p = os.path.join(out_dir, "labguard.nft")
        with open(p, "w") as f:
            f.write(render_nft(self.cfg, bundle))
        files["labguard.nft"] = p
        return files

    def _syntax_checks(self, files: dict) -> List[dict]:
        checks = []
        for key, path in files.items():
            if key.endswith(".nft"):
                rc, out = self.runner.run(["nft", "-c", "-f", path])
                checks.append(_check("Validasi sintaks nftables", "FIREWALL", key, "OK", "OK" if rc == 0 else f"ERR {out[:120]}", rc == 0))
            else:
                rc, out = self.runner.run(["dnsmasq", "--test", f"--conf-file={path}"])
                checks.append(_check("Validasi sintaks dnsmasq", "DNS", key, "OK", "OK" if rc == 0 else f"ERR {out[:120]}", rc == 0))
        return checks

    def validate(self, bundle: dict) -> List[dict]:
        with tempfile.TemporaryDirectory() as tmp:
            files = self._render_all(bundle, tmp)
            checks = self._syntax_checks(files)
        checks.append(_check("Mode", "SYSTEM", "agent", "DRY-RUN", "DRY-RUN (tidak ada perubahan jaringan)", True))
        return checks

    # ---------------------------------------------------------------- backup / restore
    def _live_paths(self) -> dict:
        return {"nft": self.cfg.nft_conf_path, "dnsmasq_dir": self.cfg.dnsmasq_dir}

    def _snapshot(self) -> str:
        snap = os.path.join(self.backup_dir, time.strftime("%Y%m%d-%H%M%S"))
        os.makedirs(snap, mode=0o700, exist_ok=True)
        rc, out = self.runner.run(["nft", "list", "table", "inet", "labguard"])
        with open(os.path.join(snap, "labguard.nft"), "w") as f:
            if rc == 0 and out.strip():
                f.write("table inet labguard\ndelete table inet labguard\n" + out + "\n")
            else:
                f.write("table inet labguard\ndelete table inet labguard\n")  # sebelumnya tidak ada tabel → hapus
        if os.path.isdir(self.cfg.dnsmasq_dir):
            shutil.copytree(self.cfg.dnsmasq_dir, os.path.join(snap, "dnsmasq"), dirs_exist_ok=True)
        with open(os.path.join(self.backup_dir, "LATEST"), "w") as f:
            f.write(snap)
        # simpan maksimal 20 snapshot
        snaps = sorted(d for d in glob.glob(os.path.join(self.backup_dir, "2*")) if os.path.isdir(d))
        for old in snaps[:-20]:
            shutil.rmtree(old, ignore_errors=True)
        return snap

    def backup_files(self) -> dict:
        out = {}
        try:
            with open(os.path.join(self.backup_dir, "LATEST")) as f:
                snap = f.read().strip()
            for p in [os.path.join(snap, "labguard.nft")] + glob.glob(os.path.join(snap, "dnsmasq", "*.conf")):
                with open(p) as f:
                    out[os.path.relpath(p, snap)] = f.read()[:200000]
        except FileNotFoundError:
            pass
        return out

    def _restart_dns(self, count: int) -> List[str]:
        errors = []
        existing = sorted(glob.glob(os.path.join(self.cfg.dnsmasq_dir, "lab-*.conf")))
        for i in range(max(count, len(existing))):
            conf = os.path.join(self.cfg.dnsmasq_dir, f"lab-{i}.conf")
            action = "restart" if os.path.exists(conf) else "stop"
            rc, out = self.runner.run(["systemctl", action, f"labguard-dnsmasq@{i}"])
            if rc != 0 and action == "restart":
                errors.append(f"labguard-dnsmasq@{i}: {out[:200]}")
            if action == "restart":
                self.runner.run(["systemctl", "enable", f"labguard-dnsmasq@{i}"])
        return errors

    def rollback(self) -> str:
        try:
            with open(os.path.join(self.backup_dir, "LATEST")) as f:
                snap = f.read().strip()
        except FileNotFoundError:
            raise ApplyError("Tidak ada backup untuk rollback")
        if os.path.isdir(os.path.join(snap, "dnsmasq")):
            shutil.rmtree(self.cfg.dnsmasq_dir, ignore_errors=True)
            shutil.copytree(os.path.join(snap, "dnsmasq"), self.cfg.dnsmasq_dir)
        else:
            for f in glob.glob(os.path.join(self.cfg.dnsmasq_dir, "lab-*.conf")):
                os.remove(f)
        rc, out = self.runner.run(["nft", "-f", os.path.join(snap, "labguard.nft")])
        if rc != 0:
            raise ApplyError(f"Rollback nftables gagal: {out[:300]}")
        shutil.copy(os.path.join(snap, "labguard.nft"), self.cfg.nft_conf_path)
        self._restart_dns(len(glob.glob(os.path.join(self.cfg.dnsmasq_dir, "lab-*.conf"))))
        return snap

    # ---------------------------------------------------------------- apply
    def _self_test(self, bundle: dict) -> List[dict]:
        checks = []
        for i, lab in enumerate(bundle["labs"]):
            port = lab_port(self.cfg, i)
            p = lab["policy"]
            tests = []
            blocked = {e["domain"] for e in p["dns"]["block"]}
            for d in ("youtube.com", "tiktok.com", "drive.google.com"):
                if d in blocked:
                    tests.append((d, "BLOCKED"))
            tests.append(("contoh-situs-tidak-diizinkan.example", "BLOCKED"))
            if p["dns"]["allow"]:
                host = "www.google.com" if "www.google.com" in p["dns"]["allow"] else p["dns"]["allow"][0]
                tests.append((host, "ALLOWED"))
            for host, expected in tests:
                rcode, ips = self.resolve(host, "127.0.0.1", port)
                if rcode is None:
                    actual = "TIMEOUT"
                else:
                    actual = "BLOCKED" if dnsclient.is_blocked(rcode, ips) else "ALLOWED"
                checks.append(_check(f"Uji DNS lab {lab.get('labName', lab['labId'])}", "DNS", host, expected, actual, actual == expected))
                if host in p["dns"].get("safeSearchHosts", []) and expected == "ALLOWED":
                    ok = p["dns"]["safeSearchIpv4"] in ips
                    checks.append(_check("SafeSearch dipaksa (DNS)", "DNS", host, p["dns"]["safeSearchIpv4"], ",".join(ips) or "-", ok))
        rc, out = self.runner.run(["nft", "list", "table", "inet", "labguard"])
        checks.append(_check("Tabel nftables aktif", "FIREWALL", "inet labguard", "PRESENT", "PRESENT" if rc == 0 else "MISSING", rc == 0))
        return checks

    def apply(self, bundle: dict) -> List[dict]:
        os.makedirs(self.cfg.dnsmasq_dir, exist_ok=True)
        os.makedirs(self.cfg.dnsmasq_log_dir, exist_ok=True)
        with tempfile.TemporaryDirectory() as tmp:
            files = self._render_all(bundle, tmp)
            checks = self._syntax_checks(files)
            if not all(c["passed"] for c in checks):
                raise ApplyError("Validasi konfigurasi gagal — tidak ada perubahan yang diterapkan", rolled_back=False, checks=checks)
            self._snapshot()  # backup SEBELUM perubahan
            try:
                self.runner.run(["sysctl", "-w", "net.ipv4.ip_forward=1"])
                for f in glob.glob(os.path.join(self.cfg.dnsmasq_dir, "lab-*.conf")):
                    os.remove(f)
                for key, path in files.items():
                    dest = self.cfg.nft_conf_path if key.endswith(".nft") else os.path.join(self.cfg.dnsmasq_dir, os.path.basename(key))
                    shutil.copy(path, dest)
                rc, out = self.runner.run(["nft", "-f", self.cfg.nft_conf_path])
                if rc != 0:
                    raise ApplyError(f"nft -f gagal: {out[:300]}")
                errs = self._restart_dns(len(bundle["labs"]))
                if errs:
                    raise ApplyError("; ".join(errs))
                time.sleep(self.settle)
                checks += self._self_test(bundle)
                failed = [c for c in checks if not c["passed"]]
                if failed:
                    raise ApplyError("Self-test gagal: " + "; ".join(f"{c['target']} {c['actual']} (harap {c['expected']})" for c in failed[:5]), checks=checks)
                return checks
            except Exception as e:  # noqa: BLE001 — rollback untuk semua kegagalan
                try:
                    self.rollback()
                    rb = True
                except Exception as e2:  # noqa: BLE001
                    rb = False
                    e = ApplyError(f"{e} | ROLLBACK GAGAL: {e2}")
                raise ApplyError(str(e), rolled_back=rb, checks=getattr(e, "checks", checks))

    def status(self) -> dict:
        rc, _ = self.runner.run(["nft", "list", "table", "inet", "labguard"])
        fw = {"state": "OK", "detail": "Tabel inet labguard aktif"} if rc == 0 else {"state": "NOT_CONFIGURED", "detail": "Tabel nftables LABGUARD belum ada"}
        confs = sorted(glob.glob(os.path.join(self.cfg.dnsmasq_dir, "lab-*.conf")))
        if not confs:
            dns = {"state": "NOT_CONFIGURED", "detail": "Belum ada konfigurasi DNS lab"}
        else:
            bad = []
            for c in confs:
                i = os.path.basename(c)[4:-5]
                rc, _ = self.runner.run(["systemctl", "is-active", f"labguard-dnsmasq@{i}"])
                if rc != 0:
                    bad.append(i)
            dns = {"state": "ERROR", "detail": f"Instance dnsmasq tidak aktif: {', '.join(bad)}"} if bad else {"state": "OK", "detail": f"{len(confs)} instance DNS filtering aktif"}
        filtering = {"state": "OK" if fw["state"] == "OK" and dns["state"] == "OK" else ("ERROR" if "ERROR" in (fw["state"], dns["state"]) else "NOT_CONFIGURED")}
        return {"dns": dns, "firewall": fw, "filtering": filtering}
