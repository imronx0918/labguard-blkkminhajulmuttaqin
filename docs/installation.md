# Instalasi & Deployment

## 1. Membuat project Firebase
1. Buka https://console.firebase.google.com → **Add project** (mis. `labguard-sman1`). Google Analytics opsional.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable.** Matikan pendaftaran publik bila tersedia (Settings → User actions → nonaktifkan *Enable create*), karena akun dibuat oleh Super Admin dari dashboard. (Biarkan aktif sementara hanya untuk registrasi Super Admin pertama.)
3. **Build → Firestore Database → Create database** → mode *Production*, lokasi `asia-southeast2 (Jakarta)`.
4. **Project settings → General → Your apps → Web app (</>)** → catat `apiKey`, `authDomain`, `appId` (bukan secret — dikirim ke browser lewat `/api/public/config`).
5. Pasang rules & index:
   ```bash
   npm i -g firebase-tools
   firebase login
   firebase use --add <project-id>
   firebase deploy --only firestore:rules,firestore:indexes
   ```

## 2. Menjalankan secara lokal dengan Firebase
```bash
npm install
cp .env.example .env
# isi FIREBASE_PROJECT_ID, FIREBASE_WEB_*, SERVER_SECRET (openssl rand -hex 32), BOOTSTRAP_TOKEN
# kredensial Admin SDK lokal (JANGAN commit):  gcloud auth application-default login
npm run dev
```
Buka http://localhost:5173 → **Registrasi Super Admin** (isi BOOTSTRAP_TOKEN). Endpoint bootstrap hanya berhasil bila belum ada Super Admin.

## 3. Deploy ke Cloud Run
```bash
PROJECT=<project-id>; REGION=asia-southeast2
gcloud config set project $PROJECT
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com
# simpan secret
printf "%s" "$(openssl rand -hex 32)" | gcloud secrets create labguard-server-secret --data-file=-
printf "%s" "$(openssl rand -hex 16)" | gcloud secrets create labguard-bootstrap-token --data-file=-
# beri akses Firestore & Auth ke service account runtime
SA=$(gcloud projects describe $PROJECT --format='value(projectNumber)')-compute@developer.gserviceaccount.com
gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$SA --role=roles/datastore.user
gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$SA --role=roles/firebaseauth.admin
gcloud secrets add-iam-policy-binding labguard-server-secret --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding labguard-bootstrap-token --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
# build & deploy (Dockerfile di root)
gcloud run deploy labguard-edu --source . --region $REGION --allow-unauthenticated \
  --min-instances 1 --max-instances 3 --memory 512Mi \
  --set-env-vars NODE_ENV=production,AUTH_MODE=firebase,DATA_STORE=firestore,FIREBASE_PROJECT_ID=$PROJECT,FIREBASE_WEB_API_KEY=<apiKey>,FIREBASE_WEB_AUTH_DOMAIN=$PROJECT.firebaseapp.com,FIREBASE_WEB_APP_ID=<appId>,PUBLIC_BASE_URL=https://<domain-anda>,CORS_ORIGINS=https://<domain-anda> \
  --set-secrets SERVER_SECRET=labguard-server-secret:latest,BOOTSTRAP_TOKEN=labguard-bootstrap-token:latest
```
- `--min-instances 1` menjaga penjadwal internal (mulai/akhiri sesi otomatis, kedaluwarsa izin, deteksi gateway offline) tetap berjalan. Alternatif: Cloud Scheduler memanggil `POST /api/internal/tick` dengan header `X-Internal-Token: <SERVER_SECRET>` tiap menit.
- Tambahkan domain Cloud Run/custom ke **Firebase Authentication → Settings → Authorized domains**.
- `SERVER_SECRET` mengenkripsi secret gateway; jika diganti, semua gateway harus di-pairing ulang.

## 4. Urutan konfigurasi (juga tersedia di menu **Instalasi Terpandu**)
1. Konfigurasi Firebase → 2. Super Admin → 3. Profil lembaga (Pengaturan) → 4. Laboratorium (isi **subnet**) → 5. Registrasi gateway → 6. Pasang Gateway Agent ([gateway-setup.md](gateway-setup.md)) → 7. Pemeriksaan jaringan (agent melaporkan validasi lolos) → 8. Registrasi perangkat → 9. Instalasi Chrome Policy ([browser-policy-setup.md](browser-policy-setup.md)) → 10–12. Uji Google Search, TikTok, YouTube di komputer lab → 13. Aktivasi LIVE MODE.

## 5. Membuat sesi pembelajaran
Menu **Sesi Pembelajaran → Buat / jadwalkan sesi**: isi nama, mapel, guru, kelas, lab, tanggal & jam (WIB), profil kebijakan. Tekan **Mulai sesi** (atau aktifkan *Mulai otomatis*). Status keamanan:
- `Menunggu konfirmasi gateway` → gateway belum melapor;
- `Aman (terkonfirmasi)` → agent mengonfirmasi penerapan;
- `Belum ada gateway` / `Gagal` → sesi **tidak** aman; periksa menu Gateway.
Saat sesi berakhir (manual/otomatis), lab kembali ke profil default dan izin sementara sesi dihapus.

## 6. Memeriksa status LIVE
- Dashboard: badge mode di sidebar, kartu "Status sistem" (DNS, firewall, sinkronisasi dari heartbeat).
- Gateway → Kelola & detail → **Tes koneksi** (umur heartbeat aktual) dan tab **Penerapan** (`CONFIRMED` + jumlah self-test lolos).
- Di komputer lab: `chrome://policy` (kebijakan browser) dan `nslookup youtube.com` → harus NXDOMAIN.

## 7. Memulihkan konfigurasi
- **Kebijakan/daftar situs**: Pengaturan → Backup konfigurasi → *Pulihkan dari file* (Super Admin) → otomatis membuat penerapan ulang.
- **Gateway**: Gateway → detail → **Rollback** (agent memulihkan snapshot nftables/dnsmasq terakhir), atau di server: `sudo python3 /opt/labguard-agent/labguard_agent.py rollback`. Snapshot ada di `/var/lib/labguard-agent/backups/` dan salinannya di tab Backup.
- **Penerapan ulang paksa**: `POST /api/policies/redeploy` (Super Admin) atau tombol Sinkronisasi.
