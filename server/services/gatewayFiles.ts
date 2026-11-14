import type { Gateway } from '../../shared/types.js';

/** Konfigurasi agent (JSON, tanpa secret — secret diperoleh lewat pairing dan disimpan 0600 di gateway). */
export function agentConfigYaml(baseUrl: string, gw: Gateway): string {
  // Nama fungsi dipertahankan untuk kompatibilitas; formatnya JSON agar agent hanya memakai pustaka standar Python.
  return JSON.stringify({
    server_url: baseUrl,
    gateway_name: gw.name,
    adapter: gw.adapter ?? 'linux-nftables-dnsmasq',
    lan_interface: 'enp2s0',
    wan_interface: 'enp1s0',
    lan_subnets: [],
    local_networks: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'], // CATATAN: sempitkan ke subnet layanan lokal saja
    upstream_dns: ['1.1.1.1', '8.8.8.8'],
    dnsmasq_dir: '/etc/labguard-agent/dnsmasq',
    dnsmasq_log_dir: '/var/log/labguard',
    dnsmasq_base_port: 5301,
    kern_log_path: '/var/log/kern.log',
    block_ipv6_forward: true,
    allow_network_changes: true,
    nft_conf_path: '/etc/labguard-agent/labguard.nft',
    state_dir: '/var/lib/labguard-agent',
    enable_nat: true,
    verify_tls: true,
  }, null, 2) + '\n';
}

export function installerScript(baseUrl: string): string {
  return `#!/usr/bin/env bash
# =====================================================================
# LABGUARD EDU — Installer LAB GATEWAY AGENT (Ubuntu Server 22.04/24.04)
# Penggunaan:  sudo bash install-labguard-gateway.sh <KODE-PAIRING>
# Gateway hanya melakukan koneksi KELUAR (HTTPS) ke ${baseUrl}
# =====================================================================
set -euo pipefail
CODE="\${1:-}"
[ "$(id -u)" -eq 0 ] || { echo "Jalankan sebagai root (sudo)"; exit 1; }
[ -n "$CODE" ] || { echo "Penggunaan: sudo bash $0 <KODE-PAIRING>"; exit 1; }
export DEBIAN_FRONTEND=noninteractive
echo "[1/6] Memasang paket: nftables, dnsmasq, python3, chrony"
apt-get update -y
apt-get install -y nftables dnsmasq python3 curl ca-certificates chrony
systemctl enable --now chrony nftables
echo "[2/6] Mengunduh agent"
mkdir -p /opt/labguard-agent /etc/labguard-agent /var/lib/labguard-agent /var/log/labguard
curl -fsSL "${baseUrl}/downloads/gateway-agent.tar.gz" -o /tmp/labguard-agent.tar.gz
tar -xzf /tmp/labguard-agent.tar.gz -C /opt/labguard-agent --strip-components=1
rm -f /tmp/labguard-agent.tar.gz
echo "[3/6] Konfigurasi"
if [ ! -f /etc/labguard-agent/agent.json ]; then
  python3 /opt/labguard-agent/labguard_agent.py init-config --server "${baseUrl}" --out /etc/labguard-agent/agent.json
  echo ">>> PERIKSA /etc/labguard-agent/agent.json (lan_interface, wan_interface, lan_subnets) sebelum LIVE MODE."
fi
chmod 700 /etc/labguard-agent /var/lib/labguard-agent
echo "[4/6] Pairing dengan kode sekali pakai"
python3 /opt/labguard-agent/labguard_agent.py --config /etc/labguard-agent/agent.json pair --code "$CODE"
echo "[5/6] DNS filtering per lab (instance dnsmasq terpisah, port 5301+)"
mkdir -p /etc/labguard-agent/dnsmasq
install -m 0644 /opt/labguard-agent/deploy/labguard-dnsmasq@.service /etc/systemd/system/labguard-dnsmasq@.service
install -m 0644 /opt/labguard-agent/deploy/logrotate-labguard /etc/logrotate.d/labguard
# dnsmasq bawaan paket tidak dipakai untuk filtering (boleh tetap dipakai untuk DHCP lab)
grep -q '^port=0' /etc/dnsmasq.conf 2>/dev/null || systemctl disable --now dnsmasq || true
echo "[6/6] Memasang layanan systemd"
install -m 0644 /opt/labguard-agent/deploy/labguard-agent.service /etc/systemd/system/labguard-agent.service
systemctl daemon-reload
systemctl enable --now labguard-agent
echo "Selesai. Status: systemctl status labguard-agent  |  Log: journalctl -u labguard-agent -f"
echo "Cek di dashboard: menu Gateway dan Jaringan → gateway harus ONLINE dalam ±1 menit."
`;
}
