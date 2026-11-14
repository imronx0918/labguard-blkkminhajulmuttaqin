import { config } from '../config.js';
import { MemoryStore } from './memoryStore.js';
import { FirestoreStore } from './firestoreStore.js';
import type { Store } from './types.js';
import { getAdminApp } from '../firebase.js';

let store: Store | null = null;

export async function initStore(override?: Store): Promise<Store> {
  if (override) return (store = override);
  if (store) return store;
  if (config.DATA_STORE === 'firestore') {
    const { getFirestore } = await import('firebase-admin/firestore');
    store = new FirestoreStore(getFirestore(getAdminApp()));
  } else {
    store = new MemoryStore(config.MEMORY_STORE_FILE);
  }
  return store;
}

export function db(): Store {
  if (!store) throw new Error('Store belum diinisialisasi');
  return store;
}
