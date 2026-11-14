"""Membaca log query dnsmasq & log kernel (nftables) → event ALLOWED/BLOCKED/BYPASS_ATTEMPT.
Hanya DOMAIN, IP klien, waktu, kategori — tanpa URL lengkap, parameter pencarian, atau isi komunikasi."""
import os
import re
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

LINE = re.compile(r"dnsmasq\[\d+\]: (\d+) ([\d.]+)/\d+ (query\[(?:A|AAAA|HTTPS)\]|config|forwarded|reply|cached) (\S+)(?: (?:is|to|from) (\S+))?")
KERN = re.compile(r"LG-BYPASS-(DOT|DOH|VPN|IP) .*?SRC=([\d.]+) DST=([\d.]+)")
BYPASS_LABEL = {"DOT": "DNS over TLS (853)", "DOH": "DNS over HTTPS ke resolver publik", "VPN": "Port VPN", "IP": "Akses langsung ke IP tidak terizinkan"}


class Tail:
    def __init__(self, path: str):
        self.path, self.pos, self.inode = path, None, None

    def read_new(self, max_bytes: int = 2_000_000) -> List[str]:
        try:
            st = os.stat(self.path)
        except FileNotFoundError:
            return []
        if self.inode != st.st_ino or (self.pos or 0) > st.st_size:
            self.inode, self.pos = st.st_ino, st.st_size if self.pos is None else 0  # start dari akhir saat pertama kali
        with open(self.path, "r", errors="replace") as f:
            f.seek(self.pos)
            data = f.read(max_bytes)
            self.pos = f.tell()
        return data.splitlines()


class DnsLogParser:
    def __init__(self, lab_id: str, category_lookup):
        self.lab_id = lab_id
        self.lookup = category_lookup  # domain -> (category, layer) | None
        self.pending: Dict[str, Tuple[str, str]] = {}
        self.seen: Dict[Tuple[str, str, str], float] = {}

    def feed(self, lines: List[str], now: Optional[datetime] = None) -> List[dict]:
        now = now or datetime.now(timezone.utc)
        out = []
        for ln in lines:
            m = LINE.search(ln)
            if not m:
                continue
            serial, client, kind, name, value = m.groups()
            name = name.lower().rstrip(".")
            if kind.startswith("query"):
                self.pending[serial] = (client, name)
                continue
            if serial not in self.pending:
                continue
            client, qname = self.pending.pop(serial)
            if kind == "config" and value in ("NXDOMAIN", "NODATA", "0.0.0.0", "::", "NODATA-IPv4", "NODATA-IPv6"):
                decision = "BLOCKED"
            elif kind in ("forwarded", "reply", "cached", "config"):
                decision = "ALLOWED"
            else:
                continue
            key = (client, qname, decision)
            ts = now.timestamp()
            if ts - self.seen.get(key, 0) < 60:  # deduplikasi 60 detik
                continue
            self.seen[key] = ts
            cat = self.lookup(qname) if decision == "BLOCKED" else None
            out.append({
                "ts": now.isoformat(), "type": decision, "clientIp": client, "domain": qname, "labId": self.lab_id,
                "category": cat[0] if cat else ("Default deny" if decision == "BLOCKED" else None),
                "reason": (f"Diblokir lapisan {cat[1]} ({cat[0]})" if cat else "Tidak ada dalam daftar izin (default deny)") if decision == "BLOCKED" else "Diizinkan kebijakan",
            })
        if len(self.seen) > 20000:
            self.seen.clear()
        if len(self.pending) > 5000:
            self.pending.clear()
        return out


def parse_kernel(lines: List[str], now: Optional[datetime] = None) -> List[dict]:
    now = now or datetime.now(timezone.utc)
    out = []
    for ln in lines:
        m = KERN.search(ln)
        if m:
            kind, src, dst = m.groups()
            out.append({"ts": now.isoformat(), "type": "BYPASS_ATTEMPT", "clientIp": src, "domain": None, "category": "Bypass", "reason": f"{BYPASS_LABEL[kind]} → {dst} diblokir"})
    return out


def build_category_lookup(policy: dict):
    entries = sorted(policy["dns"]["block"], key=lambda e: -len(e["domain"]))

    def lookup(host: str):
        for e in entries:
            if host == e["domain"] or host.endswith("." + e["domain"]):
                return e["category"], e["layer"]
        return None
    return lookup
