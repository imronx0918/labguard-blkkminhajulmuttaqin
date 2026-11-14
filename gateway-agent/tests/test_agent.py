import os
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

from agent.client import sign, signature_base  # noqa: E402
from agent.config import AgentConfig  # noqa: E402
from agent.dnsclient import build_query, is_blocked, parse_response  # noqa: E402
from agent.logwatch import DnsLogParser, build_category_lookup, parse_kernel  # noqa: E402
from agent.renderers import render_dnsmasq, render_nft, protections  # noqa: E402
from agent.runner import CommandNotAllowed, FakeRunner, Runner  # noqa: E402
from agent.state import State  # noqa: E402
from agent.validate import BundleError, validate_bundle  # noqa: E402
from adapters.base import ApplyError  # noqa: E402
from adapters.linux_nftables_dnsmasq import LinuxNftablesDnsmasqAdapter  # noqa: E402
from adapters.mikrotik import MikrotikRestAdapter  # noqa: E402
import labguard_agent  # noqa: E402
from fixtures import bundle  # noqa: E402


def cfg_in(tmp):
    return AgentConfig(server_url="https://labguard.example.sch.id", lan_interface="lan0", wan_interface="wan0",
                       dnsmasq_dir=os.path.join(tmp, "dnsmasq"), dnsmasq_log_dir=os.path.join(tmp, "log"),
                       nft_conf_path=os.path.join(tmp, "labguard.nft"), state_dir=os.path.join(tmp, "state"), kern_log_path=os.path.join(tmp, "kern.log"))


def fake_resolver(policy_allow, blocked):
    def resolve(host, server, port):
        if any(host == b or host.endswith("." + b) for b in blocked):
            return 3, []
        if any(host == a or host.endswith("." + a) for a in policy_allow):
            return 0, ["216.239.38.120"] if "google.com" in host else ["93.184.216.34"]
        return 3, []
    return resolve


class TestValidation(unittest.TestCase):
    def test_valid_bundle(self):
        self.assertEqual(validate_bundle(bundle())["version"], 3)

    def test_rejects_injection_in_domain(self):
        b = bundle()
        b["labs"][0]["policy"]["dns"]["block"].append({"domain": "evil.com/\nserver=/#/1.1.1.1", "layer": "ADMIN", "category": "x"})
        with self.assertRaises(BundleError):
            validate_bundle(b)

    def test_rejects_non_default_deny(self):
        b = bundle()
        b["labs"][0]["policy"]["dns"]["defaultDeny"] = False
        with self.assertRaises(BundleError):
            validate_bundle(b)

    def test_rejects_wide_subnet(self):
        b = bundle()
        b["labs"][0]["subnet"] = "0.0.0.0/0"
        with self.assertRaises(BundleError):
            validate_bundle(b)


class TestRenderers(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.cfg = cfg_in(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_dnsmasq_default_deny_and_blocks(self):
        conf = render_dnsmasq(self.cfg, bundle()["labs"][0], 0, 3)
        self.assertIn("address=/#/", conf)  # default deny
        self.assertIn("server=/google.com/1.1.1.1", conf)
        self.assertIn("address=/youtube.com/", conf)
        self.assertIn("address=/youtu.be/", conf)
        self.assertIn("address=/drive.google.com/", conf)  # layanan Google lain tetap diblokir
        self.assertIn("host-record=www.google.com,216.239.38.120", conf)  # SafeSearch
        self.assertIn("port=5301", conf)

    def test_full_lock_has_no_upstream(self):
        conf = render_dnsmasq(self.cfg, bundle(full_lock=True, profile_type="FULL_LOCK")["labs"][0], 0, 1)
        self.assertNotIn("server=/", conf)
        nft = render_nft(self.cfg, bundle(full_lock=True, profile_type="FULL_LOCK"))
        self.assertIn("set locked_nets { type ipv4_addr; flags interval; auto-merge; elements = { 192.168.10.0/24 }; }", nft)

    def test_nft_anti_bypass(self):
        nft = render_nft(self.cfg, bundle())
        self.assertTrue(nft.startswith("#!/usr/sbin/nft -f"))
        self.assertIn("table inet labguard\ndelete table inet labguard\ntable inet labguard {", nft)  # penggantian atomik
        self.assertIn("udp dport 53 redirect to :5301", nft)
        self.assertIn("tcp dport 853 drop", nft)
        self.assertIn("ip daddr @doh_resolvers drop", nft)
        self.assertIn("udp dport 443 drop", nft)
        self.assertIn('oifname "wan0" ip saddr @lan_nets masquerade', nft)
        self.assertIn("meta nfproto ipv6 drop", nft)

    def test_ip_enforcement_uses_nftset(self):
        conf = render_dnsmasq(self.cfg, bundle(ip_enf=True)["labs"][0], 0, 3)
        self.assertIn("nftset=/google.com/4#inet#labguard#allowed_v4", conf)

    def test_protections_lists_gaps_honestly(self):
        p = {x["key"]: x for x in protections(bundle(), self.cfg)}
        self.assertFalse(p["alt_browser"]["active"])
        self.assertFalse(p["https_decrypt"]["active"])
        self.assertTrue(p["dot"]["active"])


class TestRunner(unittest.TestCase):
    def test_arbitrary_command_rejected(self):
        with self.assertRaises(CommandNotAllowed):
            Runner().run(["bash", "-c", "rm -rf /"])
        with self.assertRaises(CommandNotAllowed):
            Runner().run(["nft", "flush", "ruleset"])
        with self.assertRaises(CommandNotAllowed):
            FakeRunner().run(["systemctl", "stop", "ssh"])


class TestAdapter(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.cfg = cfg_in(self.tmp)
        os.makedirs(self.cfg.state_dir)
        b = bundle()
        self.resolver = fake_resolver(b["labs"][0]["policy"]["dns"]["allow"], [e["domain"] for e in b["labs"][0]["policy"]["dns"]["block"]])

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_apply_success_backup_and_checks(self):
        r = FakeRunner()
        a = LinuxNftablesDnsmasqAdapter(self.cfg, r, self.resolver, settle_sec=0)
        checks = a.apply(bundle())
        self.assertTrue(all(c["passed"] for c in checks))
        self.assertTrue(any(c["target"] == "youtube.com" and c["actual"] == "BLOCKED" for c in checks))
        self.assertTrue(any(c["target"] == "www.google.com" and c["actual"] == "ALLOWED" for c in checks))
        self.assertTrue(os.path.exists(os.path.join(self.cfg.state_dir, "backups", "LATEST")))
        self.assertTrue(any(c.startswith("nft -c -f") for c in r.calls))  # validasi sebelum terapkan
        idx_check = next(i for i, c in enumerate(r.calls) if c.startswith("nft -c -f"))
        idx_apply = next(i for i, c in enumerate(r.calls) if c.startswith("nft -f ") and c.endswith("labguard.nft") and "backups" not in c)
        self.assertLess(idx_check, idx_apply)

    def test_invalid_syntax_never_applied(self):
        r = FakeRunner(fail_on="nft -c -f")
        a = LinuxNftablesDnsmasqAdapter(self.cfg, r, self.resolver, settle_sec=0)
        with self.assertRaises(ApplyError) as ctx:
            a.apply(bundle())
        self.assertFalse(ctx.exception.rolled_back)
        self.assertFalse(any(c.startswith("nft -f ") for c in r.calls))

    def test_selftest_failure_triggers_rollback(self):
        r = FakeRunner()
        bad_resolver = lambda h, s, p: (0, ["1.2.3.4"])  # semuanya ter-resolve → youtube tidak terblokir  # noqa: E731
        a = LinuxNftablesDnsmasqAdapter(self.cfg, r, bad_resolver, settle_sec=0)
        with self.assertRaises(ApplyError) as ctx:
            a.apply(bundle())
        self.assertTrue(ctx.exception.rolled_back)
        self.assertTrue(any("backups" in c and c.startswith("nft -f") for c in r.calls))

    def test_validate_is_dry_run(self):
        r = FakeRunner()
        a = LinuxNftablesDnsmasqAdapter(self.cfg, r, self.resolver, settle_sec=0)
        checks = a.validate(bundle(mode="DEMO"))
        self.assertTrue(all(c["passed"] for c in checks))
        self.assertFalse(any(c.startswith("nft -f ") or "restart" in c for c in r.calls))

    def test_missing_subnet_not_configured(self):
        b = bundle()
        b["labs"][0]["subnet"] = ""
        a = LinuxNftablesDnsmasqAdapter(self.cfg, FakeRunner(), self.resolver, settle_sec=0)
        with self.assertRaises(ApplyError) as ctx:
            a.validate(b)
        self.assertIn("BELUM DIKONFIGURASI", str(ctx.exception))

    def test_mikrotik_unverified(self):
        m = MikrotikRestAdapter(self.cfg)
        self.assertFalse(m.verified)
        with self.assertRaises(ApplyError):
            m.apply(bundle())


class FakeClient:
    def __init__(self, b):
        self.b, self.results, self.hb = b, [], []
        self.commands = []

    def current_policy(self):
        return self.b

    def apply_result(self, d):
        self.results.append(d)

    def heartbeat(self, d):
        self.hb.append(d)
        c, self.commands = self.commands, []
        return {"heartbeatIntervalSec": 30, "commands": c, "desiredBundleHash": self.b["hash"], "mode": self.b["mode"]}

    def backup(self, *a):
        pass

    def set_credentials(self, *a):
        pass


class TestAgentFlow(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.cfg = cfg_in(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def make(self, b, runner=None):
        resolver = fake_resolver(b["labs"][0]["policy"]["dns"]["allow"], [e["domain"] for e in b["labs"][0]["policy"]["dns"]["block"]])
        adapter = LinuxNftablesDnsmasqAdapter(self.cfg, runner or FakeRunner(), resolver, settle_sec=0)
        client = FakeClient(b)
        return labguard_agent.Agent(self.cfg, client=client, adapter=adapter, state=State(self.cfg.state_dir)), client

    def test_demo_mode_never_applies(self):
        r = FakeRunner()
        agent, client = self.make(bundle(mode="DEMO"), r)
        res = agent.sync()
        self.assertEqual(res["status"], "VALIDATED")
        self.assertTrue(client.results[0]["success"])
        self.assertFalse(any(c.startswith("nft -f ") for c in r.calls))
        self.assertIsNone(agent.state.applied()["version"])

    def test_live_mode_applies_and_reports(self):
        agent, client = self.make(bundle(mode="LIVE", version=7))
        self.assertEqual(agent.sync()["status"], "APPLIED")
        self.assertEqual(agent.state.applied()["version"], 7)
        self.assertTrue(client.results[-1]["success"])
        self.assertEqual(agent.sync()["status"], "UNCHANGED")

    def test_allow_network_changes_false_forces_dry_run(self):
        self.cfg.allow_network_changes = False
        r = FakeRunner()
        agent, _ = self.make(bundle(mode="LIVE"), r)
        self.assertEqual(agent.sync()["status"], "VALIDATED")
        self.assertFalse(any(c.startswith("nft -f ") for c in r.calls))

    def test_unknown_command_ignored(self):
        agent, client = self.make(bundle(mode="DEMO"))
        client.commands = [{"id": "c1", "type": "RUN_SHELL", "args": "rm -rf /"}]
        agent.heartbeat()
        self.assertNotIn("c1", agent.completed)

    def test_rejected_bundle_reported(self):
        b = bundle()
        b["labs"][0]["policy"]["dns"]["allow"].append("bad domain")
        agent, client = self.make(b)
        with self.assertRaises(BundleError):
            agent.sync()
        self.assertFalse(client.results[0]["success"])


class TestLogs(unittest.TestCase):
    def test_dnsmasq_parse_blocked_allowed(self):
        b = bundle()
        p = DnsLogParser("lab1", build_category_lookup(b["labs"][0]["policy"]))
        lines = [
            "Nov 14 09:10:12 dnsmasq[99]: 11 192.168.10.101/5353 query[A] www.youtube.com from 192.168.10.101",
            "Nov 14 09:10:12 dnsmasq[99]: 11 192.168.10.101/5353 config www.youtube.com is NXDOMAIN",
            "Nov 14 09:14:01 dnsmasq[99]: 12 192.168.10.103/5353 query[A] www.google.com from 192.168.10.103",
            "Nov 14 09:14:01 dnsmasq[99]: 12 192.168.10.103/5353 config www.google.com is 216.239.38.120",
            "Nov 14 09:14:05 dnsmasq[99]: 13 192.168.10.102/5353 query[A] www.tiktok.com from 192.168.10.102",
            "Nov 14 09:14:05 dnsmasq[99]: 13 192.168.10.102/5353 config www.tiktok.com is NXDOMAIN",
        ]
        ev = p.feed(lines, datetime(2026, 11, 14, 2, 10, tzinfo=timezone.utc))
        self.assertEqual([(e["domain"], e["type"]) for e in ev], [("www.youtube.com", "BLOCKED"), ("www.google.com", "ALLOWED"), ("www.tiktok.com", "BLOCKED")])
        self.assertEqual(ev[0]["category"], "Video dan Streaming")
        self.assertEqual(p.feed(lines[:2], datetime(2026, 11, 14, 2, 10, 30, tzinfo=timezone.utc)), [])  # deduplikasi

    def test_kernel_bypass(self):
        ev = parse_kernel(["kernel: LG-BYPASS-DOT IN=lan0 OUT=wan0 SRC=192.168.10.5 DST=1.1.1.1 LEN=60"])
        self.assertEqual(ev[0]["type"], "BYPASS_ATTEMPT")
        self.assertEqual(ev[0]["clientIp"], "192.168.10.5")


class TestCryptoAndDns(unittest.TestCase):
    def test_signature_matches_server_format(self):
        base = signature_base("1700000000", "nonce123nonce123", "post", "/api/agent/heartbeat", '{"a":1}')
        self.assertTrue(base.startswith("1700000000\nnonce123nonce123\nPOST\n/api/agent/heartbeat\n"))
        self.assertEqual(len(sign("s", "1", "n", "GET", "/p", "")), 64)

    def test_dns_packet_roundtrip(self):
        qid, q = build_query("youtube.com")
        resp = bytearray(q)
        resp[2:4] = (0x8183).to_bytes(2, "big")  # NXDOMAIN
        rcode, ips = parse_response(bytes(resp), qid)
        self.assertEqual(rcode, 3)
        self.assertTrue(is_blocked(rcode, ips))


class TestConfig(unittest.TestCase):
    def test_requires_https(self):
        with self.assertRaises(ValueError):
            AgentConfig(server_url="http://evil.example.com").validate()
        AgentConfig(server_url="http://localhost:8080").validate()

    def test_rejects_bad_iface(self):
        with self.assertRaises(ValueError):
            AgentConfig(server_url="https://a.b", lan_interface="eth0; rm -rf /").validate()


if __name__ == "__main__":
    unittest.main()
