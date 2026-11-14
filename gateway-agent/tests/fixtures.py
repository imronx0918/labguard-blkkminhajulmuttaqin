import hashlib
import json


def policy(profile_type="GOOGLE_SEARCH_ONLY", full_lock=False, ip_enf=False):
    return {
        "schema": "labguard.policy/v1", "profileId": "p1", "profileName": "GOOGLE SEARCH ONLY", "profileType": profile_type,
        "dns": {
            "defaultDeny": True,
            "allow": [] if full_lock else ["google.com", "www.google.com", "www.gstatic.com"],
            "block": [
                {"domain": "youtube.com", "layer": "ADMIN", "category": "Video dan Streaming"},
                {"domain": "youtu.be", "layer": "ADMIN", "category": "Video dan Streaming"},
                {"domain": "tiktok.com", "layer": "ADMIN", "category": "Video dan Streaming"},
                {"domain": "drive.google.com", "layer": "ADMIN", "category": "Layanan Google"},
                {"domain": "nordvpn.com", "layer": "CORE", "category": "Proxy, VPN"},
            ],
            "safeSearchHosts": [] if full_lock else ["www.google.com", "google.com"],
            "safeSearchIpv4": "216.239.38.120", "safeSearchIpv6": "2001:4860:4802:32::78",
        },
        "firewall": {"fullLock": full_lock, "blockDoT": True, "blockDoH": True, "dohResolverIps": ["8.8.8.8", "1.1.1.1"], "blockVpnPorts": True, "blockQuic": True, "ipEnforcement": ip_enf or full_lock, "forceLocalDns": True},
        "browser": {}, "layers": {}, "exceptions": [], "warnings": [],
    }


def bundle(mode="LIVE", version=3, **kw):
    labs = [{"labId": "lab1", "labName": "Lab 1", "subnet": "192.168.10.0/24", "sessionId": None, "source": "LAB_DEFAULT", "policy": policy(**kw)}]
    h = hashlib.sha256(json.dumps(labs, sort_keys=True).encode()).hexdigest()
    return {"schema": "labguard.bundle/v1", "gatewayId": "gw1", "version": version, "hash": h, "generatedAt": "2026-11-14T00:00:00Z", "mode": mode, "deploymentId": "dep1", "labs": labs}
