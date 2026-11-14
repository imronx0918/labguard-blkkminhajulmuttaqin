// Uji Firestore Security Rules — jalankan dengan emulator (membutuhkan Java):
//   npm i -D @firebase/rules-unit-testing && npx firebase emulators:exec --only firestore "npx vitest run firebase/rules.test.ts"
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await initializeTestEnvironment({ projectId: 'labguard-rules-test', firestore: { rules: readFileSync('firebase/firestore.rules', 'utf8'), host: '127.0.0.1', port: 8085 } }); });
afterAll(async () => env?.cleanup());

describe('firestore.rules default deny', () => {
  it('pengguna hanya membaca profil sendiri', async () => {
    const me = env.authenticatedContext('u1', { role: 'teacher' }).firestore();
    await assertSucceeds(me.doc('users/u1').get());
    await assertFails(me.doc('users/u2').get());
    await assertFails(me.doc('users/u1').set({ role: 'super_admin' }));
  });
  it('klien tidak dapat membaca/menulis koleksi lain, bahkan super_admin', async () => {
    const admin = env.authenticatedContext('a', { role: 'super_admin' }).firestore();
    for (const c of ['policies', 'auditLogs', 'gatewaySecrets', 'deviceCredentials', 'accessLogs', 'systemSettings']) {
      await assertFails(admin.collection(c).get());
      await assertFails(admin.doc(`${c}/x`).set({ a: 1 }));
    }
  });
  it('tidak login: semua ditolak', async () => { await assertFails(env.unauthenticatedContext().firestore().doc('users/u1').get()); });
});
