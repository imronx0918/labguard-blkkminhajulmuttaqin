"""Klien DNS minimal (pustaka standar) untuk self-test pasca-penerapan."""
import random
import socket
import struct
from typing import List, Optional, Tuple


def build_query(name: str, qtype: int = 1) -> Tuple[int, bytes]:
    qid = random.randint(0, 0xFFFF)
    header = struct.pack(">HHHHHH", qid, 0x0100, 1, 0, 0, 0)
    q = b"".join(bytes([len(p)]) + p.encode() for p in name.rstrip(".").split(".")) + b"\x00"
    return qid, header + q + struct.pack(">HH", qtype, 1)


def _skip_name(data: bytes, off: int) -> int:
    while True:
        ln = data[off]
        if ln == 0:
            return off + 1
        if ln & 0xC0 == 0xC0:
            return off + 2
        off += ln + 1


def parse_response(data: bytes, qid: int) -> Tuple[int, List[str]]:
    rid, flags, qd, an, _ns, _ar = struct.unpack(">HHHHHH", data[:12])
    if rid != qid:
        raise ValueError("ID respons tidak cocok")
    rcode = flags & 0x000F
    off = 12
    for _ in range(qd):
        off = _skip_name(data, off) + 4
    ips: List[str] = []
    for _ in range(an):
        off = _skip_name(data, off)
        rtype, _cls, _ttl, rdlen = struct.unpack(">HHIH", data[off:off + 10])
        off += 10
        if rtype == 1 and rdlen == 4:
            ips.append(socket.inet_ntoa(data[off:off + 4]))
        off += rdlen
    return rcode, ips


def resolve(name: str, server: str = "127.0.0.1", port: int = 53, timeout: float = 3.0) -> Tuple[Optional[int], List[str]]:
    """Mengembalikan (rcode, [ip]). rcode 3 = NXDOMAIN. (None, []) bila timeout."""
    qid, pkt = build_query(name)
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(timeout)
    try:
        s.sendto(pkt, (server, port))
        data, _ = s.recvfrom(4096)
        return parse_response(data, qid)
    except (socket.timeout, OSError):
        return None, []
    finally:
        s.close()


def is_blocked(rcode: Optional[int], ips: List[str]) -> bool:
    return rcode == 3 or (rcode == 0 and (not ips or all(ip == "0.0.0.0" for ip in ips)))
