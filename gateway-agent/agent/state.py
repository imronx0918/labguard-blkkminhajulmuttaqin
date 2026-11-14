"""Penyimpanan state lokal agent: secret (0600), versi terakhir yang diterapkan, bundle valid terakhir."""
import json
import os
import tempfile
from typing import Any, Optional


class State:
    def __init__(self, state_dir: str):
        self.dir = state_dir
        os.makedirs(self.dir, mode=0o700, exist_ok=True)

    def _path(self, name: str) -> str:
        return os.path.join(self.dir, name)

    def _write(self, name: str, data: Any, mode: int = 0o600) -> None:
        fd, tmp = tempfile.mkstemp(dir=self.dir)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.chmod(tmp, mode)
        os.replace(tmp, self._path(name))

    def _read(self, name: str, default: Any = None) -> Any:
        try:
            with open(self._path(name), "r", encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return default

    # Kredensial gateway
    def save_credentials(self, gateway_id: str, secret: str) -> None:
        self._write("credentials.json", {"gateway_id": gateway_id, "secret": secret}, 0o600)

    def credentials(self) -> Optional[dict]:
        return self._read("credentials.json")

    # Bundle yang terakhir berhasil diterapkan (dipertahankan saat offline)
    def save_applied(self, version: int, bundle_hash: str, bundle: dict) -> None:
        self._write("applied.json", {"version": version, "hash": bundle_hash})
        self._write("last-good-bundle.json", bundle)

    def applied(self) -> dict:
        return self._read("applied.json", {"version": None, "hash": None})

    def last_good_bundle(self) -> Optional[dict]:
        return self._read("last-good-bundle.json")

    def save_validated(self, version: int, bundle_hash: str) -> None:
        self._write("validated.json", {"version": version, "hash": bundle_hash})

    def validated(self) -> dict:
        return self._read("validated.json", {"version": None, "hash": None})
