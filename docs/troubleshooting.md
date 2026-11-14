# Troubleshooting

| Gejala | Pemeriksaan | Solusi |
|---|---|---|
| Gateway OFFLINE | `systemctl status labguard-agent`, `journalctl -u labguard-agent -n 50` | Cek koneksi HTTPS ke dashboard, jam (`timedatectl`; error `CLOCK_SKEW`), secret dicabut (`GATEWAY_REVOKED` → pairing ulang) |
| `BAD_SIGNATURE` / `REPLAY` | Log agent | Pastikan tidak ada dua agent dengan kredensial sama; restart agent |
| Penerapan `FAILED`/`ROLLED_BACK` | Gateway → detail → Penerapan (pesan & self-test) | Periksa `lan_interface`/`wan_interface`, subnet lab, `nft -c -f /etc/labguard-agent/labguard.nft`, `dnsmasq --test --conf-file=…` |
| Sesi "Belum ada gateway" | Laboratorium → kolom Gateway | Hubungkan lab ke gateway & isi subnet |
| Sesi lama "Menunggu konfirmasi" | Gateway online? Mode LIVE? | Di DEMO tidak ada konfirmasi LIVE (status `DEMO — disimulasikan`) |
| Google tidak termuat sempurna | DevTools/`chrome://net-export` | Kebijakan → Diagnostik Google; tambahkan host resource yang disarankan |
| `chrome://policy` kosong | Registry `HKLM\SOFTWARE\Policies\Google\Chrome` / `/etc/opt/chrome/policies/managed` | Jalankan installer sebagai Administrator/root; Reload policies |
| Perangkat "Belum terbaru" | Task Scheduler `LabGuardEduDeviceAgent` / `systemctl status labguard-device-agent.timer` | Token dicabut? Registrasi ulang perangkat |
| Log tidak muncul | `/var/log/labguard/dnsmasq-lab-N.log` | Pastikan PC memakai gateway sebagai default route (DNS di-redirect di gateway) |
| Tidak bisa SSH ke gateway setelah LIVE | Konsol lokal | Agent tidak mengubah chain input SSH; `sudo python3 /opt/labguard-agent/labguard_agent.py rollback` atau `sudo nft delete table inet labguard` (darurat) |
| Error 403 di dashboard | Peran pengguna | Hak akses ditegakkan server; minta Super Admin mengubah peran |
| Index Firestore hilang (`FAILED_PRECONDITION`) | Log Cloud Run | `firebase deploy --only firestore:indexes` |
