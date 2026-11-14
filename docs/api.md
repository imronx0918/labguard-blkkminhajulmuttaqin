# Referensi API

Basis: `/api`. Format JSON. Error: `{ "error": { "code", "message", "details?" } }`. Semua endpoint pengguna memerlukan `Authorization: Bearer <Firebase ID token>`; izin diperiksa di server (lihat `shared/roles.ts`). Daftar memakai `?limit=&cursor=` (paginasi kursor) → `{ items, nextCursor }`.

## Publik & autentikasi
| Metode | Path | Keterangan |
|---|---|---|
| GET | /public/config | Nama app, mode, authMode, konfigurasi Firebase Web (bukan secret) |
| GET | /public/health | Health check |
| POST | /auth/bootstrap | Super Admin pertama (BOOTSTRAP_TOKEN + ID token) |
| GET | /auth/me | Profil + daftar izin |
| POST | /auth/login-event, /auth/logout-event | Audit login/logout |
| GET/POST | /auth/demo-users, /auth/demo-login | **Hanya AUTH_MODE=demo** |

## Pengguna (izin)
| Metode | Path | Izin |
|---|---|---|
| GET | /dashboard | dashboard.view |
| GET/POST | /devices | devices.view / devices.manage |
| GET/PUT/DELETE | /devices/:id | devices.view / manage |
| GET | /devices/:id/logs | devices.view |
| POST | /devices/:id/register `{platform}` | devices.manage — token sekali tampil + installer |
| POST | /devices/:id/revoke, /status, /resync, /pair-gateway; /devices/bulk-group | devices.manage |
| CRUD | /students (+ POST /students/import), /classes (+ POST /classes/:id/map-lab), /laboratories | *.view / *.manage |
| GET/POST | /policies | policies.view / manage |
| GET/PUT/DELETE | /policies/:id | policies.view / manage (kategori inti: policies.core) |
| POST | /policies/:id/duplicate | policies.manage |
| GET | /policies/:id/compiled | policies.view |
| POST | /policies/:id/evaluate `{inputs[]}` | policies.view — hasil DNS & browser terpisah |
| GET | /policies/:id/browser-policy?format=windows-ps1\|windows-reg\|linux-sh\|linux-json | policies.view |
| POST | /policies/google-diagnostics/analyze, /add | policies.view / manage |
| POST | /policies/redeploy `{labIds}` | policies.rollback |
| GET/POST/PUT/DELETE | /sites/categories, /sites/blocked (+/bulk), /sites/allowed | sites.view / manage (inti: sites.core) |
| GET/POST | /sessions | sessions.view / create |
| GET/PUT | /sessions/:id | sessions.view / create (pemilik atau manageAll) |
| POST | /sessions/:id/start, /stop, /cancel, /assign | sessions.run / create |
| GET/POST | /permission-requests | permissionRequests.create (guru hanya miliknya) |
| POST | /permission-requests/:id/approve `{date?,startTime?,endTime?,note,overrideAdminBlock,coreOverride}` | permissionRequests.review (+ coreOverride: Super Admin) |
| POST | /permission-requests/:id/reject `{note}`, /revoke | permissionRequests.review |
| GET | /access-logs?type&labId&deviceId&domain&from&to | logs.view |
| GET | /audit-logs?action&userId&from&to | audit.view |
| GET | /deployments | gateways.view |
| GET/POST | /gateways (+ GET /gateways/installer) | gateways.view / manage |
| GET/PUT/DELETE | /gateways/:id | gateways.view / manage |
| GET | /gateways/:id/logs, /bundle-preview, /config, /backups/:bid | gateways.view / manage |
| POST | /gateways/:id/pairing-code, /revoke | gateways.manage |
| POST | /gateways/:id/commands `{type}` (APPLY_POLICY, RELOAD_FILTERING, CHECK_STATUS, ROLLBACK, SYNC_CONFIGURATION, BACKUP_CONFIGURATION) | gateways.test (+manage/rollback untuk sebagian) |
| POST | /gateways/:id/test-connection | gateways.test |
| GET | /reports/:type (lab-usage, devices, sessions, internet-activity, blocked-attempts, gateway-status, policy-deployments, permission-requests) | reports.view |
| GET/POST/PUT/DELETE | /users, /users/teachers | users.view / manage |
| GET/PUT | /settings | settings.view / manage |
| GET/POST | /settings/setup, /settings/setup/:key | settings.view / manage |
| POST | /settings/mode `{mode, confirm:true}` | system.mode |
| GET/POST | /settings/backup, /settings/restore | backup.manage |
| POST/DELETE | /settings/demo-data | settings.manage (hanya DEMO) |
| GET/POST | /notifications, /notifications/:id/read, /notifications/read-all | login |

## Gateway Agent (`Authorization: Gateway <id>` + HMAC)
Header: `X-LG-Timestamp` (unix detik), `X-LG-Nonce` (≥16 char, sekali pakai), `X-LG-Signature = hex(HMAC_SHA256(secret, ts \n nonce \n METHOD \n path \n sha256(body)))`.

| Metode | Path | Keterangan |
|---|---|---|
| POST | /agent/pair `{code, hostname, agentVersion, localIp}` | Tanpa HMAC; kode sekali pakai, rate limit 10/15 menit → `{gatewayId, secret}` |
| GET | /agent/policy/current | Bundle `labguard.bundle/v1` (versi, hash, mode, labs[].policy) |
| POST | /agent/heartbeat | Status komponen, proteksi, klien ARP → `{commands[], desiredBundleHash, mode}` |
| POST | /agent/events `{events[≤500]}` | ALLOWED/BLOCKED/BYPASS_ATTEMPT/… (domain saja) |
| POST | /agent/apply-result | Satu-satunya jalur yang mengubah status menjadi CONFIRMED |
| POST | /agent/backup | Salinan konfigurasi sebelum perubahan |

## Agen perangkat (`Authorization: Device <uuid>:<token>`)
| GET | /device-agent/browser-policy | Kebijakan browser efektif lab + versi |
| POST | /device-agent/checkin | Versi terpasang, status, OS |

## Internal
`POST /api/internal/tick` dengan `X-Internal-Token: <SERVER_SECRET>` — untuk Cloud Scheduler.
