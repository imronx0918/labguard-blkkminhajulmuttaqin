# Keamanan & Privasi

## Autentikasi & otorisasi
- Pengguna: Firebase Authentication (ID token diverifikasi `verifyIdToken(token, checkRevoked=true)`). Peran diambil dari dokumen `users/{uid}` (sumber kebenaran) dan disalin ke custom claim; perubahan peran mencabut refresh token.
- Setiap route memakai `requirePermission(...)` di server; menu frontend hanya kosmetik. Akses ditolak dicatat (`ACCESS_DENIED`).
- Guru hanya dapat membuat/menjalankan sesi miliknya, memilih profil yang tersedia, dan mengajukan izin. Guru tidak dapat mengubah profil, firewall, mode, atau daftar situs.
- Kategori inti (Proxy/VPN, DoH) dan override inti hanya Super Admin. Super Admin terakhir tidak dapat dihapus/diturunkan.
- Firestore Security Rules: default deny; klien hanya membaca profil sendiri. Seluruh akses data lewat backend (Admin SDK).

## Gateway & perangkat
- Pairing: kode sekali pakai (30 menit, disimpan sebagai SHA-256), rate limit.
- Secret gateway 256-bit, disimpan terenkripsi AES-256-GCM (kunci diturunkan dari `SERVER_SECRET`), di agent disimpan 0600.
- Setiap permintaan agent ditandatangani HMAC-SHA256 atas timestamp, nonce, metode, path, dan hash body; jendela waktu ±5 menit; nonce unik (koleksi `agentNonces` dengan TTL) → pencegahan replay.
- Rotasi: terbitkan kode pairing baru (secret lama berlaku sampai pairing ulang). Revoke: secret dihapus seketika.
- Tidak ada endpoint eksekusi shell. Agent hanya menerima 6 operasi whitelist dan `Runner` hanya mengizinkan pola argumen `nft`/`dnsmasq`/`systemctl labguard-dnsmasq@N`/`sysctl` tertentu, tanpa shell.
- Bundle divalidasi ketat (regex domain, subnet ≥ /16, default-deny wajib) sebelum dirender → mencegah injeksi konfigurasi.
- Perangkat: identitas UUID + token acak 256-bit (disimpan hash). MAC address hanya informasi, bukan autentikasi.

## Aplikasi web
Helmet (CSP, HSTS, frameguard), CORS allowlist, rate limiting global (600/menit/IP) dan khusus login/pairing/agent, validasi Zod untuk semua input + sanitasi karakter kontrol/`<>`, batas body 1 MB, error handler terpusat tanpa stack trace, audit log append-only (tidak ada endpoint ubah/hapus).
Secret tidak pernah dikirim ke frontend; konfigurasi Firebase Web bukan secret. Server menolak start di produksi bila `SERVER_SECRET` < 32 karakter atau `AUTH_MODE=demo`.

## Privasi peserta didik
- Data peserta didik minimal: NIS, nama, kelas, jurusan, status.
- Tidak ada dekripsi HTTPS, tangkapan layar, atau pengumpulan isi komunikasi/kata sandi.
- Log hanya domain (bukan URL lengkap/parameter pencarian), kategori, waktu, perangkat, hasil kebijakan. Event ALLOWED dapat dimatikan. Retensi default 90 hari, dihapus otomatis.
- Pembatasan hanya pada perangkat & jaringan lab milik lembaga.

## Keterbatasan yang diketahui (tidak diklaim kebal bypass)
| Celah | Status |
|---|---|
| VPN/proxy melalui TCP 443 ke server tak dikenal | Tidak terdeteksi tanpa dekripsi; mitigasi: ekstensi diblokir, akun non-admin, penegakan IP pada profil ketat |
| DoH ke resolver privat | Tidak terdeteksi; mitigasi: `DnsOverHttpsMode=off`, blok IP DoH publik, penegakan IP |
| Browser portabel/rename executable | DisallowRun mudah dilewati; gunakan AppLocker/WDAC + akun standar |
| Akses IP langsung | Diblokir browser (URLBlocklist `*`) dan firewall bila penegakan IP aktif; tanpanya, aplikasi non-browser dapat menjangkau IP |
| Hotspot seluler / jaringan lain | Di luar kendali gateway |
| Perangkat yang dikelola peserta (admin lokal) | Kebijakan dapat dihapus; wajib akun standar & manajemen terpusat |
