# Kebijakan Browser (Chrome & Edge Enterprise)

Kebijakan browser **terpisah** dari DNS: hanya browser yang dapat memfilter **path URL**. DNS bekerja pada nama domain dan tidak dapat membedakan `www.google.com/search` dari `www.google.com/maps`.

## Isi kebijakan GOOGLE SEARCH ONLY
| Policy | Nilai | Tujuan |
|---|---|---|
| URLBlocklist | `*`, `javascript://*`, `file://*`, domain kategori blokir, `.www.google.com/maps` … | Default deny + path non-pencarian |
| URLAllowlist | `.www.google.com`, `.google.com`, `.www.google.co.id`, `.google.co.id`, `chrome://policy` | Hanya host pencarian **persis** (awalan titik = tanpa subdomain), sehingga `mail.`/`drive.`/`photos.`/`gemini.google.com` tetap diblokir |
| ForceGoogleSafeSearch | true | SafeSearch terkunci |
| ForceYouTubeRestrict | 2 | Lapisan tambahan bila YouTube dibuka oleh pengecualian |
| IncognitoModeAvailability | 1 | Incognito dimatikan |
| BrowserGuestModeEnabled / BrowserAddPersonEnabled | false | Tidak ada profil tamu/baru |
| DeveloperToolsAvailability | 2 | DevTools dimatikan |
| ExtensionInstallBlocklist | `*` | Ekstensi (termasuk proxy/VPN) diblokir |
| DnsOverHttpsMode | off | DoH browser dimatikan |
| ProxyMode | direct | Proxy manual tidak dapat dipasang |
| BrowserSignin / SyncDisabled / PasswordManagerEnabled | 0 / true / false | Tidak login akun & tidak menyimpan kata sandi |
| HomepageLocation / RestoreOnStartupURLs / DefaultSearchProvider | Google Search | Halaman awal pencarian |

Mengklik hasil pencarian melalui `www.google.com/url?q=…` diizinkan (host yang sama), tetapi tujuan akhirnya diblokir bila tidak ada di daftar izin (TEST 3).

## Windows
1. Menu **Perangkat → Registrasi** → pilih Windows → unduh `labguard-<PC>.ps1` (berisi token unik perangkat; agen sinkron tiap 5 menit via Task Scheduler `LabGuardEduDeviceAgent`). Atau tanpa agen: **Kebijakan → Uji & generator → Windows PowerShell/.reg**.
2. Jalankan sebagai Administrator:
   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\labguard-PC-LAB1-01.ps1
   ```
3. Akun peserta didik **harus akun standar (bukan Administrator)**. Untuk banyak PC gunakan GPO/Intune dan AppLocker untuk memblokir browser lain (`DisallowRun` di installer hanya lapisan dasar dan dapat dilewati bila file di-rename).

## Linux
```bash
sudo bash labguard-PC-LAB1-01.sh
```
Menulis `/etc/opt/chrome/policies/managed/labguard.json` (juga Chromium & Edge), memvalidasi JSON, membuat backup di `/var/backups/labguard-edu`, dan memasang `labguard-device-agent.timer`.

## Verifikasi
1. Buka `chrome://policy` → **Reload policies** → semua kebijakan di atas berstatus **OK** dengan sumber *Platform/Machine*.
2. Buka `https://www.google.com` → cari kata kunci → hasil tampil (SafeSearch terkunci).
3. Buka `https://www.youtube.com`, `https://youtu.be/x`, `https://www.tiktok.com`, `https://drive.google.com` → halaman "diblokir administrator".
4. Catat hasilnya di **Instalasi Terpandu** (langkah 10–12).

## Diagnostik bila halaman Google tidak termuat sempurna
URLBlocklist terutama berlaku untuk navigasi; namun DNS default-deny dapat memblokir host resource. Di komputer uji (oleh admin), buka DevTools Network atau `chrome://net-export`, salin host yang gagal (`ERR_NAME_NOT_RESOLVED`, `ERR_BLOCKED_BY_ADMINISTRATOR`), lalu tempel di **Kebijakan → Diagnostik Google**. Sistem hanya mengizinkan host resource milik Google (gstatic/googleapis/googleusercontent) dan menolak host aplikasi (Gmail, Drive, Photos, Gemini, YouTube). Penambahan dicatat di audit log dan memicu penerapan ulang.
