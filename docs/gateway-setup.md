# Pemasangan LAB GATEWAY AGENT (Ubuntu Server)

## Topologi
```
Router/ISP ──(WAN: enp1s0)── [Ubuntu Gateway] ──(LAN: enp2s0)── Switch lab ── PC lab
```
Jika router sekolah memiliki API resmi yang didukung, adapter khusus dapat dipakai; saat ini hanya adapter **linux-nftables-dnsmasq** yang terverifikasi. Adapter MikroTik masih kerangka (BELUM DIVERIFIKASI).

## Kebutuhan
- Ubuntu Server 22.04/24.04, 2 NIC, 2 GB RAM, jam tersinkron (chrony/NTP — wajib untuk anti-replay).
- Akses keluar HTTPS ke URL dashboard. **Tidak perlu membuka port masuk apa pun.**
- DHCP untuk lab (dapat memakai DHCP router atau dnsmasq terpisah). Disarankan **DHCP reservation** agar IP perangkat stabil (untuk pemetaan log ke perangkat).
- Jalankan `sudo sysctl -w net.ipv4.ip_forward=1` (agent juga mengaturnya) dan pastikan default gateway PC lab = IP LAN gateway.

## Langkah
1. Dashboard → **Laboratorium**: isi subnet setiap lab (mis. `192.168.10.0/24`).
2. Dashboard → **Gateway dan Jaringan → Registrasi gateway** → pilih lab → catat **kode pairing** (berlaku 30 menit, sekali pakai).
3. Unduh installer (tombol *Download installer*) lalu di gateway:
   ```bash
   sudo bash install-labguard-gateway.sh ABCDE-FGHJK
   ```
   Installer memasang `nftables dnsmasq python3 chrony`, mengunduh agent ke `/opt/labguard-agent`, membuat `/etc/labguard-agent/agent.json`, pairing, memasang `labguard-agent.service` dan template `labguard-dnsmasq@.service`.
4. Edit `/etc/labguard-agent/agent.json`:
   - `lan_interface`, `wan_interface` (cek `ip -br link`);
   - `local_networks`: subnet layanan lokal yang tetap boleh diakses (server e-learning lokal, printer). Sempitkan dari default;
   - `allow_network_changes`: `false` untuk memaksa dry-run di gateway ini apa pun mode server.
5. Validasi tanpa mengubah jaringan: `sudo python3 /opt/labguard-agent/labguard_agent.py validate`.
6. `sudo systemctl restart labguard-agent && journalctl -u labguard-agent -f`. Dashboard akan menampilkan gateway **ONLINE**.

## Apa yang diterapkan (LIVE)
- `/etc/labguard-agent/dnsmasq/lab-N.conf` + `labguard-dnsmasq@N` (port 5301+N) — DNS default-deny per lab, log query (domain saja) di `/var/log/labguard/`.
- `/etc/labguard-agent/labguard.nft` — tabel `inet labguard` (diganti atomik, tidak menyentuh tabel lain): redirect DNS, blok DoT/DoH/VPN/QUIC/IPv6, FULL LOCK, penegakan IP opsional, NAT masquerade.
- Sebelum perubahan: snapshot ke `/var/lib/labguard-agent/backups/<waktu>/` + unggah ke dashboard. Setelah perubahan: self-test DNS (YouTube/TikTok/Drive harus diblokir, Google harus ter-resolve ke IP SafeSearch). Gagal → rollback otomatis dan dilaporkan.

## Akses administrasi
Agent tidak membuat aturan pada chain `input` selain menutup port DNS lab dari WAN, sehingga SSH ke gateway tidak terputus. Tetap batasi SSH via `ufw allow from <subnet-admin> to any port 22`.

## Saat gateway offline / server tidak terjangkau
Aturan terakhir yang valid tetap aktif (tidak fail-open). Agent mencoba ulang dengan backoff dan mengirim event tertunda saat kembali online.

## Docker (opsional, lingkungan uji)
`gateway-agent/docker-compose.yml` menjalankan agent dengan `network_mode: host` + `NET_ADMIN`. Mode systemd direkomendasikan untuk produksi.
