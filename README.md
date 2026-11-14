# LABGUARD EDU

**Sistem Manajemen dan Pengendalian Akses Internet Laboratorium Komputer** untuk sekolah, madrasah, dan pesantren.
Kebijakan bawaan **GOOGLE SEARCH ONLY**: peserta didik hanya dapat memakai Google Search (SafeSearch wajib); situs lain ditolak secara default.

| Komponen | Teknologi | Lokasi |
|---|---|---|
| Dashboard web | React 18, TypeScript, Vite, Tailwind, TanStack Query, React Router, Recharts, Lucide | `src/` |
| Backend API | Node.js, Express, TypeScript, Zod, Firebase Admin SDK, rate limiting, helmet | `server/` |
| Logika bersama | Policy compiler, generator Chrome policy, matriks peran | `shared/` |
| Database & auth | Cloud Firestore + Firebase Authentication, Security Rules default-deny | `firebase/` |
| LAB GATEWAY AGENT | Python 3 (stdlib), nftables, dnsmasq, systemd | `gateway-agent/` |
| Dokumentasi | Arsitektur, instalasi, gateway, kebijakan browser, API, keamanan, troubleshooting | `docs/` |

## Mulai cepat (mode DEMO lokal)

```bash
npm install
cp .env.example .env    # set AUTH_MODE=demo dan DATA_STORE=memory untuk uji lokal
npm run dev             # API :8080, web :5173
```

Mode DEMO memakai akun contoh dan penyimpanan file JSON server-side. **Tidak ada perubahan jaringan** — gateway agent hanya memvalidasi (dry-run). Untuk produksi ikuti [docs/installation.md](docs/installation.md).

## Pengujian

```bash
npm run typecheck      # TypeScript frontend + backend
npm test               # 51 uji: policy compiler (URL & DNS terpisah) + integrasi API (RBAC, sesi, izin, gateway HMAC)
npm run test:agent     # 35 uji agent, termasuk dnsmasq NYATA & nft -c bila terpasang
npm run test:rules     # Firestore rules (butuh Firebase emulator + Java)
```

## Prinsip yang ditegakkan kode

- Status gateway ONLINE hanya dari heartbeat bertanda tangan HMAC yang valid.
- Kebijakan dinyatakan "diterapkan/aman" hanya setelah `POST /api/agent/apply-result` dari agent.
- Semua peran diperiksa di backend; Firestore rules menolak akses langsung klien.
- Tidak ada endpoint eksekusi shell; agent hanya menjalankan perintah whitelist.
- Tanpa dekripsi HTTPS; log hanya domain, waktu, perangkat, kategori, dan hasil kebijakan.
- Gateway offline mempertahankan kebijakan terakhir yang valid (tidak fail-open).
- Fitur yang butuh perangkat/konfigurasi tambahan berstatus **BELUM DIKONFIGURASI**, bukan berpura-pura berhasil.

Lihat [docs/architecture.md](docs/architecture.md) untuk keterbatasan teknis setiap lapisan.
