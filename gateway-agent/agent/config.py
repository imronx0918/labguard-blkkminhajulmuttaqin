"""Konfigurasi LAB GATEWAY AGENT (JSON, hanya pustaka standar)."""
import ipaddress
import json
import os
import re
from dataclasses import dataclass, field, asdict
from typing import List

IFACE_RE = re.compile(r"^[a-zA-Z0-9._-]{1,15}$")


@dataclass
class AgentConfig:
    server_url: str
    gateway_name: str = ""
    adapter: str = "linux-nftables-dnsmasq"
    lan_interface: str = "enp2s0"
    wan_interface: str = "enp1s0"
    lan_subnets: List[str] = field(default_factory=list)
    local_networks: List[str] = field(default_factory=lambda: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"])
    admin_ssh_subnet: str = ""
    upstream_dns: List[str] = field(default_factory=lambda: ["1.1.1.1", "8.8.8.8"])
    dnsmasq_dir: str = "/etc/labguard-agent/dnsmasq"
    dnsmasq_log_dir: str = "/var/log/labguard"
    dnsmasq_base_port: int = 5301
    nft_conf_path: str = "/etc/labguard-agent/labguard.nft"
    state_dir: str = "/var/lib/labguard-agent"
    kern_log_path: str = "/var/log/kern.log"
    enable_nat: bool = True
    block_ipv6_forward: bool = True
    verify_tls: bool = True
    ca_bundle: str = ""
    # Keamanan: agent TIDAK menerapkan perubahan jaringan bila false (paksa dry-run), apapun mode server.
    allow_network_changes: bool = True

    def validate(self) -> None:
        if not re.match(r"^https?://[A-Za-z0-9.-]+(:\d+)?(/.*)?$", self.server_url):
            raise ValueError("server_url tidak valid")
        if self.server_url.startswith("http://") and not re.match(r"^http://(localhost|127\.0\.0\.1)", self.server_url):
            raise ValueError("server_url wajib HTTPS (http hanya untuk localhost/pengujian)")
        for name in ("lan_interface", "wan_interface"):
            if not IFACE_RE.match(getattr(self, name)):
                raise ValueError(f"{name} tidak valid")
        for n in self.lan_subnets + self.local_networks:
            ipaddress.ip_network(n, strict=False)
        for ip in self.upstream_dns:
            ipaddress.ip_address(ip)
        if self.admin_ssh_subnet:
            ipaddress.ip_network(self.admin_ssh_subnet, strict=False)
        if not (1024 < self.dnsmasq_base_port < 65000):
            raise ValueError("dnsmasq_base_port tidak valid")

    @classmethod
    def load(cls, path: str) -> "AgentConfig":
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        known = {k: v for k, v in raw.items() if k in cls.__dataclass_fields__}
        cfg = cls(**known)
        cfg.validate()
        return cfg

    def save(self, path: str) -> None:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(asdict(self), f, indent=2)
