import { initializeApp, getApps, applicationDefault, type App } from 'firebase-admin/app';
import { config } from './config.js';

// Firebase Admin SDK hanya berjalan di server. Kredensial berasal dari
// Application Default Credentials (Cloud Run service account) atau GOOGLE_APPLICATION_CREDENTIALS.
export function getAdminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  return initializeApp({ credential: applicationDefault(), projectId: config.FIREBASE_PROJECT_ID });
}
