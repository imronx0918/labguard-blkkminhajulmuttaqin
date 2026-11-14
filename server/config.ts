import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(8080),
  NODE_ENV: z.string().default('development'),
  AUTH_MODE: z.enum(['firebase', 'demo']).default('demo'),
  DATA_STORE: z.enum(['firestore', 'memory']).default('memory'),
  MEMORY_STORE_FILE: z.string().default('./data/demo-store.json'),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_WEB_API_KEY: z.string().optional(),
  FIREBASE_WEB_AUTH_DOMAIN: z.string().optional(),
  FIREBASE_WEB_APP_ID: z.string().optional(),
  SERVER_SECRET: z.string().default(''),
  BOOTSTRAP_TOKEN: z.string().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:8080'),
  SCHEDULER_ENABLED: z.string().default('true'),
});

const env = schema.parse(process.env);

if (env.NODE_ENV === 'production' && env.SERVER_SECRET.length < 32) {
  throw new Error('SERVER_SECRET wajib diisi (minimal 32 karakter) pada mode produksi.');
}
if (env.NODE_ENV === 'production' && env.AUTH_MODE === 'demo' && process.env.ALLOW_DEMO_IN_PRODUCTION !== 'true') {
  throw new Error('AUTH_MODE=demo tidak diizinkan di produksi (set ALLOW_DEMO_IN_PRODUCTION=true hanya untuk instance demo publik).');
}

export const config = {
  ...env,
  SERVER_SECRET: env.SERVER_SECRET || 'dev-only-secret-change-me-0123456789abcdef',
  corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  isDemoAuth: env.AUTH_MODE === 'demo',
  schedulerEnabled: env.SCHEDULER_ENABLED !== 'false',
};
