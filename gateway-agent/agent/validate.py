"""Validasi ketat bundle kebijakan sebelum dirender. Bundle yang tidak lolos TIDAK pernah diterapkan."""
import ipaddress
import re

DOMAIN_RE = re.compile(r"^(?=.{1,253}$)(?!-)([a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$")
SAFE_TEXT = re.compile(r"^[^\n\r\x00]{0,200}$")
PROFILE_TYPES = {"GOOGLE_SEARCH_ONLY", "LEARNING", "FULL_LOCK", "CUSTOM"}
LAYERS = {"CORE", "ADMIN", "SESSION", "EXCEPTION", "DEFAULT"}


class BundleError(ValueError):
    pass


def _domain(d: str, where: str) -> str:
    if not isinstance(d, str) or not DOMAIN_RE.match(d):
        raise BundleError(f"Domain tidak valid di {where}: {d!r}")
    return d


def validate_bundle(b: dict) -> dict:
    if not isinstance(b, dict) or b.get("schema") != "labguard.bundle/v1":
        raise BundleError("Skema bundle tidak dikenal")
    if not isinstance(b.get("version"), int) or b["version"] < 0:
        raise BundleError("Versi bundle tidak valid")
    if not isinstance(b.get("hash"), str) or not re.match(r"^[a-f0-9]{64}$", b["hash"]):
        raise BundleError("Hash bundle tidak valid")
    if b.get("mode") not in ("DEMO", "LIVE"):
        raise BundleError("Mode tidak valid")
    labs = b.get("labs")
    if not isinstance(labs, list) or len(labs) > 32:
        raise BundleError("Daftar lab tidak valid")
    for lab in labs:
        if not isinstance(lab.get("labId"), str) or not re.match(r"^[A-Za-z0-9_-]{1,128}$", lab["labId"]):
            raise BundleError("labId tidak valid")
        if lab.get("subnet"):
            net = ipaddress.ip_network(lab["subnet"], strict=False)
            if net.version != 4 or net.prefixlen < 16:
                raise BundleError(f"Subnet lab terlalu luas/tidak valid: {lab['subnet']}")
        p = lab.get("policy") or {}
        if p.get("schema") != "labguard.policy/v1" or p.get("profileType") not in PROFILE_TYPES:
            raise BundleError("Kebijakan lab tidak valid")
        if not SAFE_TEXT.match(str(p.get("profileName", ""))):
            raise BundleError("Nama profil tidak valid")
        dns = p.get("dns") or {}
        if dns.get("defaultDeny") is not True:
            raise BundleError("Kebijakan DNS wajib default deny")
        if len(dns.get("allow", [])) > 5000 or len(dns.get("block", [])) > 50000:
            raise BundleError("Daftar domain terlalu besar")
        for d in dns.get("allow", []):
            _domain(d, "dns.allow")
        for e in dns.get("block", []):
            _domain(e.get("domain"), "dns.block")
            if e.get("layer") not in LAYERS:
                raise BundleError("Layer aturan tidak valid")
            if not SAFE_TEXT.match(str(e.get("category", ""))):
                raise BundleError("Kategori tidak valid")
        for h in dns.get("safeSearchHosts", []):
            _domain(h, "dns.safeSearchHosts")
        ipaddress.ip_address(dns.get("safeSearchIpv4", "216.239.38.120"))
        ipaddress.ip_address(dns.get("safeSearchIpv6", "2001:4860:4802:32::78"))
        fw = p.get("firewall") or {}
        for k in ("fullLock", "blockDoT", "blockDoH", "blockVpnPorts", "blockQuic", "ipEnforcement", "forceLocalDns"):
            if not isinstance(fw.get(k), bool):
                raise BundleError(f"firewall.{k} wajib boolean")
        if len(fw.get("dohResolverIps", [])) > 500:
            raise BundleError("Daftar resolver DoH terlalu besar")
        for ip in fw.get("dohResolverIps", []):
            ipaddress.ip_address(ip)
    return b
