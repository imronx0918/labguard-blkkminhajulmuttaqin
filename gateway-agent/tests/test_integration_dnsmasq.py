"""Uji integrasi NYATA: menjalankan dnsmasq dengan konfigurasi hasil generator lalu mengirim query DNS.
Dilewati otomatis bila dnsmasq tidak terpasang. Tidak mengubah konfigurasi jaringan sistem (port tinggi, tanpa nftables)."""
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))
from agent.config import AgentConfig  # noqa: E402
from agent.dnsclient import is_blocked, resolve  # noqa: E402
from agent.renderers import render_dnsmasq, render_nft  # noqa: E402
from fixtures import bundle  # noqa: E402

DNSMASQ = shutil.which("dnsmasq") or ("/usr/sbin/dnsmasq" if os.path.exists("/usr/sbin/dnsmasq") else None)
PORT = 15353


@unittest.skipUnless(DNSMASQ, "dnsmasq tidak terpasang")
class TestRealDnsFiltering(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cfg = AgentConfig(server_url="https://x.y", dnsmasq_log_dir=cls.tmp, dnsmasq_base_port=PORT)
        cls.conf = os.path.join(cls.tmp, "lab-0.conf")
        with open(cls.conf, "w") as f:
            f.write(render_dnsmasq(cfg, bundle()["labs"][0], 0, 1) + "listen-address=127.0.0.1\nbind-interfaces\n")
        cls.proc = subprocess.Popen([DNSMASQ, "-k", f"--conf-file={cls.conf}", "--user=" + ("root" if os.geteuid() == 0 else os.getlogin())], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        time.sleep(1.0)

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(5)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def q(self, name):
        return resolve(name, "127.0.0.1", PORT, timeout=2)

    def test_youtube_blocked(self):  # TEST 4 (lapisan DNS)
        self.assertTrue(is_blocked(*self.q("youtube.com")))
        self.assertTrue(is_blocked(*self.q("www.youtube.com")))

    def test_youtu_be_blocked(self):  # TEST 5 (lapisan DNS)
        self.assertTrue(is_blocked(*self.q("youtu.be")))

    def test_tiktok_blocked(self):  # TEST 6 (lapisan DNS)
        self.assertTrue(is_blocked(*self.q("www.tiktok.com")))

    def test_google_drive_blocked(self):  # TEST 7 (lapisan DNS)
        self.assertTrue(is_blocked(*self.q("drive.google.com")))

    def test_default_deny(self):  # TEST 3 (lapisan DNS: situs tujuan tidak diizinkan)
        self.assertTrue(is_blocked(*self.q("contoh-situs-tidak-diizinkan.com")))

    def test_google_search_resolves_to_safesearch(self):  # TEST 1 (lapisan DNS) + SafeSearch
        rcode, ips = self.q("www.google.com")
        self.assertEqual(rcode, 0)
        self.assertIn("216.239.38.120", ips)

    def test_query_log_parsed(self):
        from agent.logwatch import DnsLogParser, build_category_lookup
        self.q("www.tiktok.com")
        time.sleep(0.3)
        with open(os.path.join(self.tmp, "dnsmasq-lab-0.log")) as f:
            lines = f.read().splitlines()
        ev = DnsLogParser("lab1", build_category_lookup(bundle()["labs"][0]["policy"])).feed(lines)
        self.assertTrue(any(e["domain"] == "www.tiktok.com" and e["type"] == "BLOCKED" for e in ev))


@unittest.skipUnless(shutil.which("nft") or os.path.exists("/usr/sbin/nft"), "nft tidak terpasang")
class TestRealNftSyntax(unittest.TestCase):
    def test_nft_check(self):
        tmp = tempfile.mkdtemp()
        try:
            for kw in ({}, {"ip_enf": True}, {"full_lock": True, "profile_type": "FULL_LOCK"}):
                p = os.path.join(tmp, "r.nft")
                with open(p, "w") as f:
                    f.write(render_nft(AgentConfig(server_url="https://x.y", lan_interface="lo", wan_interface="lo"), bundle(**kw)))
                r = subprocess.run(["nft", "-c", "-f", p], capture_output=True, text=True)
                if r.returncode != 0 and "Operation not permitted" in r.stderr:
                    self.skipTest("nft -c memerlukan CAP_NET_ADMIN")
                self.assertEqual(r.returncode, 0, r.stderr)
        finally:
            shutil.rmtree(tmp)


if __name__ == "__main__":
    unittest.main()
