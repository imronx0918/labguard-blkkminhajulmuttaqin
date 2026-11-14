# Arsitektur LABGUARD EDU

```
 ┌──────────────── Cloud (Cloud Run + Firebase) ────────────────┐
 │  React dashboard ──HTTPS──► Express API ──Admin SDK──► Firestore│
 │        ▲ Firebase Auth ID token        │  Firebase Auth         │
 └────────┼───────────────────────────────┼───────────────────────┘
          │ admin/guru (browser)          │ HTTPS keluar saja (HMAC + nonce)
          │                               │
 ┌────────┴──────── Jaringan sekolah ─────┼───────────────────────┐
 │  Router internet ── [WAN] Ubuntu LAB GATEWAY [LAN] ── Switch lab │
 │                        │ nftables (anti-bypass, NAT)            │
 │                        │ dnsmasq per lab (DNS default-deny)     │
 │                        └ labguard-agent (Python)                │
 │  PC lab: Chrome/Edge + kebijakan terkelola + agen sinkron (5 mnt)│
 └─────────────────────────────────────────────────────────────────┘
```

## Tiga lapisan penegakan (terpisah, saling melengkapi)

| Lapisan | Mekanisme | Dapat | TIDAK dapat |
|---|---|---|---|
| Browser | Chrome/Edge Enterprise policy (`URLBlocklist ["*"]`, `URLAllowlist` host+path, `ForceGoogleSafeSearch`, Incognito/Guest/DevTools/ekstensi/DoH/proxy dikunci) | Memfilter **path URL** (mis. `www.google.com/search` boleh, `/maps` tidak) | Mengendalikan browser lain/aplikasi non-browser |
| DNS | dnsmasq per lab, `address=/#/` (default deny), `server=/domain/` untuk izin, `host-record` SafeSearch | Memblokir domain & subdomain/CDN untuk semua aplikasi | Membedakan path URL; mencegah akses via IP langsung |
| Firewall | nftables tabel `inet labguard` | Redirect DNS port 53, blok DoT/DoH publik/VPN/QUIC/IPv6, FULL LOCK, opsi penegakan IP (`nftset` dari DNS) | Mendeteksi VPN berbasis TCP/443 atau DoH privat tanpa dekripsi (sengaja tidak dilakukan) |

Google Search dipisahkan dari layanan Google lain: browser hanya mengizinkan host persis (`.www.google.com`, `.google.co.id`, …) dan memblokir path non-pencarian; DNS memblokir `drive.`, `mail.`, `docs.`, `photos.`, `gemini.` dll. secara eksplisit (lebih spesifik daripada `google.com`).

## Prioritas aturan
1. **CORE** — kategori inti (Proxy/VPN/anonymizer, DoH publik). Hanya Super Admin; pengecualian butuh `coreOverride` oleh Super Admin.
2. **ADMIN** — kategori blokir global yang dipilih profil. Pengecualian butuh `overrideAdminBlock` dari admin.
3. **SESSION** — profil kebijakan sesi/lab (allow/block domain & URL).
4. **EXCEPTION** — izin sementara dari permintaan guru yang disetujui; selalu punya `expiresAt`.

Implementasi: `shared/policyCompiler.ts` (diuji di `tests/compiler.test.ts`).

## Alur kebijakan
1. Perubahan (mulai sesi, edit profil, persetujuan izin, dll.) → `requestDeployment()` menghitung bundle per gateway, menaikkan `desiredPolicyVersion`, membuat `policyDeployments` berstatus `PENDING` (LIVE) atau `SIMULATED_DEMO` (DEMO).
2. Agent heartbeat → melihat hash berbeda → `GET /api/agent/policy/current`.
3. Agent memvalidasi skema → render konfigurasi → `nft -c`/`dnsmasq --test` → backup → terapkan → self-test DNS → laporkan `apply-result`. Gagal → rollback otomatis.
4. Server menandai `CONFIRMED` dan memperbarui `appliedPolicyVersion`; sesi menjadi `SECURED` hanya jika semua deployment terkait terkonfirmasi.

Perangkat: installer per-perangkat (token unik) menarik `GET /api/device-agent/browser-policy` tiap 5 menit dan melapor `checkin` dengan versi terpasang → status `UP_TO_DATE`/`OUTDATED`.

## Model data Firestore

| Koleksi | Isi / relasi | Query utama |
|---|---|---|
| users | uid Firebase, role, labIds | by role |
| students | nis, name, classId → classes | classId+name |
| classes | name, grade, homeroomTeacher, defaultLabId → laboratories, studentCount (denormalisasi) | name |
| laboratories | subnet, gatewayId, defaultPolicyId, activeSessionId | — |
| devices | id=UUID, labId, gatewayId, ip, credentialStatus, lastSeenAt, appliedPolicyVersion | labId, status+lastSeenAt |
| deviceCredentials | sha256(token), revoked — **server only** | by id |
| gateways | labIds, status, desired/appliedPolicyVersion, lastHeartbeatAt, komponen status | — |
| gatewaySecrets | hash kode pairing, secret terenkripsi AES-256-GCM — **server only** | pairingCodeHash |
| policies / policyRules | profil + cermin aturan per baris | type+builtin, policyId |
| websiteCategories / blockedDomains / allowedDomains | kategori (core), domain blokir, izin global/lab/sementara (expiresAt) | categoryId+domain, temporary |
| sessions / sessionDevices | jadwal WIB, startAt/endAt (Timestamp), securityStatus, deploymentIds | labId+date, status+startAt |
| permissionRequests | periode, status, reviewer, allowedDomainId | requestedBy/status+createdAt |
| accessLogs | ts, type, domain, kategori, perangkat, lab, sesi, dayKey | type/labId/deviceId+ts (paginasi kursor) |
| dailyStats | penghitung harian (increment) untuk dashboard | getMany 7 id |
| gatewayHeartbeats / policyDeployments / configBackups | riwayat agent | gatewayId+ts/createdAt |
| auditLogs | tindakan admin, hasil, IP — **server only, append-only** | action/userId+ts |
| notifications | audience (roles), readBy | audience contains + createdAt |
| systemSettings/main | mode DEMO/LIVE, profil lembaga, keamanan, retensi, checklist | — |
| agentNonces | anti-replay, TTL `expiresAt` | — |

Dashboard tidak membaca seluruh koleksi: memakai agregasi `count()` dan dokumen `dailyStats`. Log besar memakai paginasi kursor; untuk analitik jangka panjang ekspor `accessLogs` ke BigQuery (Firebase Extension "Stream Firestore to BigQuery") lalu kurangi retensi Firestore.

## Mode
- **DEMO**: agent hanya dry-run (`nft -c`, `dnsmasq --test`), hasil `SIMULATED_DEMO`, data contoh berlabel DEMO, banner ungu di UI.
- **LIVE**: hanya dapat diaktifkan setelah checklist instalasi lengkap (gateway online, validasi lolos, perangkat melapor kebijakan, uji Google/TikTok/YouTube dicatat) dan data DEMO dihapus.

## Adapter router
`gateway-agent/adapters/base.py` mendefinisikan antarmuka. `linux_nftables_dnsmasq.py` terverifikasi (diuji dengan nft & dnsmasq nyata). `mikrotik.py` hanya kerangka — **BELUM DIVERIFIKASI**, menolak `apply()`.
