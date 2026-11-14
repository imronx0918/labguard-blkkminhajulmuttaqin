"""Eksekusi perintah sistem yang DIBATASI (whitelist argv, tanpa shell). Tidak ada perintah bebas dari dashboard."""
import re
import subprocess
from typing import List, Tuple

ALLOWED = [
    re.compile(r"^nft -c -f [\w./-]+$"),
    re.compile(r"^nft -f [\w./-]+$"),
    re.compile(r"^nft list table inet labguard$"),
    re.compile(r"^nft list ruleset$"),
    re.compile(r"^dnsmasq --test --conf-file=[\w./-]+$"),
    re.compile(r"^systemctl (restart|stop|start|is-active|enable|disable) labguard-dnsmasq@\d{1,2}$"),
    re.compile(r"^systemctl is-active nftables$"),
    re.compile(r"^sysctl -w net\.ipv4\.ip_forward=1$"),
]


class CommandNotAllowed(Exception):
    pass


class Runner:
    def run(self, argv: List[str], timeout: int = 60) -> Tuple[int, str]:
        line = " ".join(argv)
        if not any(p.match(line) for p in ALLOWED):
            raise CommandNotAllowed(line)
        try:
            p = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, shell=False)
        except FileNotFoundError:
            return 127, f"{argv[0]}: perintah tidak ditemukan (pasang paket yang diperlukan)"
        except subprocess.TimeoutExpired:
            return 124, f"{argv[0]}: timeout"
        return p.returncode, (p.stdout + p.stderr).strip()


class FakeRunner(Runner):
    """Runner untuk pengujian: mencatat perintah, dapat disetel untuk gagal."""

    def __init__(self, fail_on: str = "", outputs: dict = None):
        self.calls: List[str] = []
        self.fail_on = fail_on
        self.outputs = outputs or {}

    def run(self, argv: List[str], timeout: int = 60) -> Tuple[int, str]:
        line = " ".join(argv)
        if not any(p.match(line) for p in ALLOWED):
            raise CommandNotAllowed(line)
        self.calls.append(line)
        if self.fail_on and self.fail_on in line:
            return 1, f"simulated failure: {line}"
        for k, v in self.outputs.items():
            if k in line:
                return 0, v
        return 0, ""
