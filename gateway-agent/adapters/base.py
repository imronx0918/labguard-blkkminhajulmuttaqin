"""Antarmuka adapter perangkat jaringan. Setiap adapter wajib mendukung validate/apply/rollback/status."""
from abc import ABC, abstractmethod
from typing import List


class ApplyError(Exception):
    def __init__(self, message: str, rolled_back: bool = False, checks: List[dict] = None):
        super().__init__(message)
        self.rolled_back = rolled_back
        self.checks = checks or []


class NetworkAdapter(ABC):
    name = "base"
    verified = False  # True hanya bila implementasi telah diuji pada perangkat nyata

    @abstractmethod
    def validate(self, bundle: dict) -> List[dict]:
        """Render + uji sintaks tanpa mengubah jaringan (dry-run). Mengembalikan daftar check."""

    @abstractmethod
    def apply(self, bundle: dict) -> List[dict]:
        """Backup → render → validasi → terapkan → self-test. Rollback otomatis bila gagal (raise ApplyError)."""

    @abstractmethod
    def rollback(self) -> str:
        """Pulihkan konfigurasi dari backup terakhir."""

    @abstractmethod
    def status(self) -> dict:
        """{'dns': {...}, 'firewall': {...}, 'filtering': {...}}"""

    def backup_files(self) -> dict:
        return {}
