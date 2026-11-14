"""Configuration generator: bundle kebijakan → konfigurasi dnsmasq (per lab) dan ruleset nftables.

Desain:
- Setiap lab memiliki instance dnsmasq sendiri (port base+index) karena profil antar-lab dapat berbeda.
- Semua query DNS dari subnet lab di-redirect (DNAT) ke instance lab tersebut → DNS alternatif tidak dapat dipakai.
- Tabel nftables "inet labguard" diganti ATOMIK (table/delete/table dalam satu transaksi) dan hanya
  menyentuh tabel milik LABGUARD — aturan sistem lain tidak diubah.
"""
from typing import Dict, List

from .config import AgentConfig

VPN_UDP = "{ 500, 1194, 1701, 4500, 51820 }"
VPN_TCP = "{ 1194, 1723 }"


def lab_port(cfg: AgentConfig, index: int) -> int:
    return cfg.dnsmasq_base_port + index


def render_dnsmasq(cfg: AgentConfig, lab: dict, index: int, version: int) -> str:
    p = lab["policy"]
    dns, fw = p["dns"], p["firewall"]
    port = lab_port(cfg, index)
    out: List[str] = [
        f"# LABGUARD EDU — dnsmasq lab {lab['labId']} ({lab.get('labName', '')}) — kebijakan v{version} — DIHASILKAN OTOMATIS, JANGAN DIEDIT",
        f"# Profil: {p['profileName']} ({p['profileType']})",
        f"port={port}",
        "no-resolv", "no-hosts", "no-poll", "domain-needed", "bogus-priv", "cache-size=10000",
        "log-queries=extra", f"log-facility={cfg.dnsmasq_log_dir}/dnsmasq-lab-{index}.log",
        "# DEFAULT DENY: semua nama dijawab NXDOMAIN kecuali diizinkan di bawah",
        "address=/#/",
        "# Matikan DoH default Firefox (canary domain)",
        "address=/use-application-dns.net/",
        "address=/mask.icloud.com/", "address=/mask-h2.icloud.com/",
    ]
    if not fw["fullLock"]:
        out.append("# --- Domain diizinkan (termasuk subdomain) ---")
        for d in dns["allow"]:
            for up in cfg.upstream_dns:
                out.append(f"server=/{d}/{up}")
            if fw["ipEnforcement"]:
                out.append(f"nftset=/{d}/4#inet#labguard#allowed_v4")
        if dns.get("safeSearchHosts"):
            out.append("# --- SafeSearch dipaksa via forcesafesearch.google.com ---")
            for h in dns["safeSearchHosts"]:
                out.append(f"host-record={h},{dns['safeSearchIpv4']},{dns['safeSearchIpv6']}")
                if fw["ipEnforcement"]:
                    out.append(f"nftset=/{h}/4#inet#labguard#allowed_v4")
    out.append("# --- Domain diblokir (lebih spesifik menang atas server=) ---")
    for e in dns["block"]:
        out.append(f"address=/{e['domain']}/")
    return "\n".join(out) + "\n"


def _set(name: str, elements: List[str], typ: str = "ipv4_addr", interval: bool = True) -> str:
    flags = "flags interval; " if interval else ""
    els = f" elements = {{ {', '.join(elements)} }};" if elements else ""
    return f"  set {name} {{ type {typ}; {flags}auto-merge;{els} }}" if interval else f"  set {name} {{ type {typ};{els} }}"


def render_nft(cfg: AgentConfig, bundle: dict) -> str:
    lan, wan = cfg.lan_interface, cfg.wan_interface
    labs = [l for l in bundle["labs"] if l.get("subnet")]
    all_subnets = [l["subnet"] for l in labs] or cfg.lan_subnets
    locked = [l["subnet"] for l in labs if l["policy"]["firewall"]["fullLock"]]
    strict = [l["subnet"] for l in labs if l["policy"]["firewall"]["ipEnforcement"] and not l["policy"]["firewall"]["fullLock"]]
    doh_ips: List[str] = sorted({ip for l in labs for ip in l["policy"]["firewall"].get("dohResolverIps", [])})
    any_fw: Dict[str, bool] = {k: any(l["policy"]["firewall"][k] for l in labs) for k in ("blockDoT", "blockDoH", "blockVpnPorts", "blockQuic", "forceLocalDns")}

    L: List[str] = [
        "#!/usr/sbin/nft -f",
        f"# LABGUARD EDU — ruleset kebijakan v{bundle['version']} ({bundle['hash'][:12]}) — DIHASILKAN OTOMATIS",
        "table inet labguard",
        "delete table inet labguard",
        "table inet labguard {",
        _set("lan_nets", all_subnets),
        _set("local_nets", cfg.local_networks),
        _set("locked_nets", locked),
        _set("strict_nets", strict),
        _set("doh_resolvers", doh_ips, interval=False),
        "  set allowed_v4 { type ipv4_addr; flags timeout; timeout 2h; }",
        "",
        "  chain prerouting_nat {",
        "    type nat hook prerouting priority dstnat; policy accept;",
    ]
    if any_fw["forceLocalDns"]:
        for i, lab in enumerate(bundle["labs"]):
            if not lab.get("subnet"):
                continue
            port = lab_port(cfg, i)
            L.append(f'    iifname "{lan}" ip saddr {lab["subnet"]} udp dport 53 redirect to :{port}  # DNS lab {lab["labId"]} dipaksa ke gateway')
            L.append(f'    iifname "{lan}" ip saddr {lab["subnet"]} tcp dport 53 redirect to :{port}')
    L += [
        "  }",
        "",
        "  chain input {",
        "    type filter hook input priority filter; policy accept;",
        f'    iifname "{wan}" udp dport {cfg.dnsmasq_base_port}-{cfg.dnsmasq_base_port + 63} drop',
        f'    iifname "{wan}" tcp dport {cfg.dnsmasq_base_port}-{cfg.dnsmasq_base_port + 63} drop',
        "  }",
        "",
        "  chain forward {",
        "    type filter hook forward priority filter; policy accept;",
        f'    iifname "{lan}" ip saddr @lan_nets jump lab_out',
    ]
    if cfg.block_ipv6_forward:
        L.append(f'    iifname "{lan}" meta nfproto ipv6 drop  # cegah bypass via IPv6')
    L += [
        "  }",
        "",
        "  chain lab_out {",
        "    ip daddr @local_nets accept  # layanan lokal tetap dapat diakses",
        "    ip saddr @locked_nets drop    # FULL INTERNET LOCK",
    ]
    if any_fw["blockDoT"]:
        L += ['    tcp dport 853 limit rate 10/minute log prefix "LG-BYPASS-DOT " level warn', "    tcp dport 853 drop", "    udp dport 853 drop"]
    if any_fw["blockDoH"] and doh_ips:
        L += ['    ip daddr @doh_resolvers limit rate 10/minute log prefix "LG-BYPASS-DOH " level warn', "    ip daddr @doh_resolvers drop"]
    if any_fw["blockVpnPorts"]:
        L += [f'    udp dport {VPN_UDP} limit rate 10/minute log prefix "LG-BYPASS-VPN " level warn', f"    udp dport {VPN_UDP} drop", f"    tcp dport {VPN_TCP} drop", "    ip protocol { gre, esp, ah } drop"]
    if any_fw["blockQuic"]:
        L.append("    udp dport 443 drop  # QUIC diblokir agar lalu lintas web lewat TCP/TLS biasa")
    L += [
        "    udp dport 53 drop  # DNS selain ke gateway (seharusnya sudah di-redirect)",
        "    tcp dport 53 drop",
        '    ip saddr @strict_nets ip daddr != @allowed_v4 limit rate 10/minute log prefix "LG-BYPASS-IP " level warn',
        "    ip saddr @strict_nets ip daddr != @allowed_v4 drop  # akses IP langsung yang tidak di-resolve via DNS terizinkan",
        "    accept",
        "  }",
    ]
    if cfg.enable_nat:
        L += ["", "  chain postrouting_nat {", "    type nat hook postrouting priority srcnat; policy accept;", f'    oifname "{wan}" ip saddr @lan_nets masquerade', "  }"]
    L.append("}")
    return "\n".join(L) + "\n"


def protections(bundle: dict, cfg: AgentConfig) -> List[dict]:
    """Daftar perlindungan aktif DAN celah yang belum ditangani (jujur, tidak mengklaim kebal bypass)."""
    labs = bundle.get("labs", [])
    fw = lambda k: any(l["policy"]["firewall"][k] for l in labs)  # noqa: E731
    return [
        {"key": "dns_redirect", "label": "DNS alternatif dipaksa ke resolver gateway (port 53 di-redirect)", "active": fw("forceLocalDns") and bool(labs)},
        {"key": "dot", "label": "DNS over TLS (port 853) diblokir", "active": fw("blockDoT")},
        {"key": "doh", "label": "DNS over HTTPS: resolver publik diblokir (IP + domain)", "active": fw("blockDoH"), "note": "Resolver DoH privat/tak dikenal tidak dapat dideteksi tanpa dekripsi; tutup juga via kebijakan browser DnsOverHttpsMode=off."},
        {"key": "vpn", "label": "Port VPN umum (OpenVPN, WireGuard, IPsec, PPTP, L2TP) diblokir", "active": fw("blockVpnPorts"), "note": "VPN berbasis TCP/443 tidak dapat dibedakan dari HTTPS biasa."},
        {"key": "quic", "label": "QUIC/HTTP3 (UDP 443) diblokir", "active": fw("blockQuic")},
        {"key": "direct_ip", "label": "Akses langsung ke alamat IP (penegakan IP allowlist)", "active": fw("ipEnforcement"), "note": "Hanya aktif pada profil dengan penegakan IP. Pada profil lain, URLBlocklist browser memblokir URL berbasis IP."},
        {"key": "ipv6", "label": "Forwarding IPv6 dari LAN lab diblokir", "active": cfg.block_ipv6_forward},
        {"key": "proxy", "label": "Situs proxy/VPN/anonymizer diblokir per domain", "active": True, "note": "Proxy pada domain/IP yang belum terdaftar tidak terdeteksi otomatis."},
        {"key": "alt_browser", "label": "Pembatasan browser alternatif", "active": False, "note": "Tidak dapat ditegakkan dari gateway. Gunakan installer kebijakan perangkat + AppLocker/akun non-admin."},
        {"key": "https_decrypt", "label": "Dekripsi HTTPS", "active": False, "note": "Sengaja TIDAK dilakukan (privasi). Pemfilteran path URL dilakukan oleh kebijakan browser terkelola."},
    ]
