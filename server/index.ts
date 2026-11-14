import { config } from './config.js';
import { initStore } from './store/index.js';
import { ensureBaseSeed, ensureDemoUsers } from './services/seed.js';
import { startScheduler } from './services/scheduler.js';
import { createApp } from './app.js';

async function main() {
  await initStore();
  await ensureBaseSeed();
  await ensureDemoUsers();
  const app = createApp();
  app.listen(config.PORT, () => {
    console.log(`[LABGUARD EDU] API berjalan di port ${config.PORT} — auth=${config.AUTH_MODE} store=${config.DATA_STORE}`);
    if (config.AUTH_MODE === 'demo') console.warn('[LABGUARD EDU] PERINGATAN: AUTH_MODE=demo — hanya untuk pengujian. Gunakan AUTH_MODE=firebase untuk produksi.');
  });
  if (config.schedulerEnabled) startScheduler();
}

main().catch((e) => { console.error(e); process.exit(1); });
