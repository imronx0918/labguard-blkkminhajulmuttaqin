"""Klien HTTPS ke backend LABGUARD EDU dengan tanda tangan HMAC-SHA256 + nonce (anti-replay)."""
import hashlib
import hmac
import json
import secrets
import ssl
import time
import urllib.error
import urllib.request
from typing import Any, Optional
from urllib.parse import urlparse


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status


def signature_base(ts: str, nonce: str, method: str, path: str, body: str) -> str:
    return f"{ts}\n{nonce}\n{method.upper()}\n{path}\n{hashlib.sha256(body.encode()).hexdigest()}"


def sign(secret: str, ts: str, nonce: str, method: str, path: str, body: str) -> str:
    return hmac.new(secret.encode(), signature_base(ts, nonce, method, path, body).encode(), hashlib.sha256).hexdigest()


class ApiClient:
    def __init__(self, base_url: str, verify_tls: bool = True, ca_bundle: str = "", timeout: int = 20):
        self.base = base_url.rstrip("/")
        self.base_path = urlparse(self.base).path.rstrip("/")
        self.timeout = timeout
        self.ctx = ssl.create_default_context(cafile=ca_bundle or None)
        if not verify_tls:  # hanya untuk pengujian lokal
            self.ctx.check_hostname = False
            self.ctx.verify_mode = ssl.CERT_NONE
        self.gateway_id: Optional[str] = None
        self.secret: Optional[str] = None

    def set_credentials(self, gateway_id: str, secret: str) -> None:
        self.gateway_id, self.secret = gateway_id, secret

    def request(self, method: str, path: str, payload: Any = None, signed: bool = True) -> Any:
        body = "" if payload is None else json.dumps(payload, separators=(",", ":"))
        headers = {"Content-Type": "application/json", "User-Agent": "labguard-gateway-agent/1.0"}
        if signed:
            if not self.gateway_id or not self.secret:
                raise ApiError(0, "Agent belum dipasangkan (pairing)")
            ts, nonce = str(int(time.time())), secrets.token_urlsafe(18)
            headers.update({
                "Authorization": f"Gateway {self.gateway_id}", "X-LG-Timestamp": ts, "X-LG-Nonce": nonce,
                "X-LG-Signature": sign(self.secret, ts, nonce, method, self.base_path + path, body),
            })
        req = urllib.request.Request(self.base + path, data=body.encode() if body else None, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout, context=self.ctx if self.base.startswith("https") else None) as r:
                raw = r.read().decode()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read().decode()).get("error", {}).get("message", "")
            except Exception:  # noqa: BLE001
                msg = e.reason
            raise ApiError(e.code, msg) from None
        except urllib.error.URLError as e:
            raise ApiError(0, f"Tidak dapat terhubung ke server: {e.reason}") from None

    # Endpoint API agent
    def pair(self, code: str, hostname: str, agent_version: str, local_ip: str) -> dict:
        return self.request("POST", "/api/agent/pair", {"code": code, "hostname": hostname, "agentVersion": agent_version, "localIp": local_ip}, signed=False)

    def current_policy(self) -> dict:
        return self.request("GET", "/api/agent/policy/current")

    def heartbeat(self, data: dict) -> dict:
        return self.request("POST", "/api/agent/heartbeat", data)

    def events(self, events: list) -> dict:
        return self.request("POST", "/api/agent/events", {"events": events})

    def apply_result(self, data: dict) -> dict:
        return self.request("POST", "/api/agent/apply-result", data)

    def backup(self, reason: str, version: Optional[int], files: dict) -> dict:
        return self.request("POST", "/api/agent/backup", {"reason": reason, "version": version, "files": files})
