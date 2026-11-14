"""Adapter MikroTik RouterOS v7 REST API — KERANGKA, BELUM DIVERIFIKASI.

Status: BELUM DIVERIFIKASI pada perangkat nyata. Agent menolak apply() dengan adapter ini kecuali
'experimental_router_adapters' diaktifkan secara eksplisit. Jangan mengklaim kompatibilitas sebelum diuji.
Rencana pemetaan:
  - dns.block  → /ip/dns/static (type=NXDOMAIN, match-subdomain=yes)
  - firewall   → /ip/firewall/filter chain=forward (DoT 853, VPN ports, QUIC) + /ip/firewall/nat dstnat port 53
"""
from typing import List

from .base import ApplyError, NetworkAdapter


class MikrotikRestAdapter(NetworkAdapter):
    name = "mikrotik-routeros-rest"
    verified = False

    def __init__(self, cfg, runner=None):
        self.cfg = cfg

    def _not_ready(self):
        raise ApplyError("Adapter MikroTik BELUM DIVERIFIKASI — gunakan adapter linux-nftables-dnsmasq. (BELUM DIKONFIGURASI)")

    def validate(self, bundle: dict) -> List[dict]:
        return [{"name": "Adapter MikroTik", "layer": "SYSTEM", "target": "routeros", "expected": "VERIFIED", "actual": "NOT_VERIFIED", "passed": False}]

    def apply(self, bundle: dict) -> List[dict]:
        self._not_ready()
        return []

    def rollback(self) -> str:
        self._not_ready()
        return ""

    def status(self) -> dict:
        nc = {"state": "NOT_CONFIGURED", "detail": "Adapter MikroTik belum diverifikasi"}
        return {"dns": nc, "firewall": nc, "filtering": nc}
