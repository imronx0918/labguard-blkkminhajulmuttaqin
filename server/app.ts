import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { requireAuth, requirePermission } from './middleware/auth.js';
import { requireDevice } from './middleware/agentAuth.js';
import { errorHandler, notFoundHandler, ah } from './middleware/errors.js';
import { authRouter, publicRouter } from './routes/auth.js';
import dashboard from './routes/dashboard.js';
import devices, { deviceAgentRouter } from './routes/devices.js';
import { studentsRouter, classesRouter, labsRouter } from './routes/basic.js';
import policies from './routes/policies.js';
import sites from './routes/sites.js';
import sessions from './routes/sessions.js';
import permissionRequests from './routes/permissionRequests.js';
import { accessLogsRouter, auditLogsRouter, deploymentsRouter } from './routes/logs.js';
import gateways from './routes/gateways.js';
import agent from './routes/agent.js';
import reports from './routes/reports.js';
import users from './routes/users.js';
import settings from './routes/settings.js';
import notifications from './routes/notifications.js';
import { tick } from './services/scheduler.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // Cloud Run / reverse proxy
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://apis.google.com', 'https://www.gstatic.com'],
        connectSrc: ["'self'", 'https://*.googleapis.com', 'https://*.firebaseio.com', 'https://securetoken.googleapis.com', 'https://identitytoolkit.googleapis.com'],
        frameSrc: ["'self'", 'https://*.firebaseapp.com'],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)), credentials: false }));
  app.use(compression());
  // simpan raw body untuk verifikasi HMAC agent
  app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { (req as any).rawBody = buf.toString('utf8'); } }));

  const apiLimiter = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMIT', message: 'Terlalu banyak permintaan, coba lagi sebentar' } } });
  app.use('/api', apiLimiter);

  app.use('/api/public', publicRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/agent', agent);
  app.use('/api/device-agent', rateLimit({ windowMs: 60_000, limit: 30, keyGenerator: (req) => String(req.headers.authorization ?? req.ip) }), requireDevice, deviceAgentRouter);
  // Tick penjadwal untuk Cloud Scheduler (dilindungi token internal)
  app.post('/api/internal/tick', ah(async (req, res) => {
    if (req.headers['x-internal-token'] !== config.SERVER_SECRET) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    await tick();
    res.json({ ok: true });
  }));

  // Semua endpoint di bawah ini memerlukan login Firebase + pemeriksaan peran server-side
  app.use('/api', requireAuth);
  app.use('/api/dashboard', dashboard);
  app.use('/api/devices', devices);
  app.use('/api/students', studentsRouter);
  app.use('/api/classes', classesRouter);
  app.use('/api/laboratories', labsRouter);
  app.use('/api/policies', policies);
  app.use('/api/sites', sites);
  app.use('/api/sessions', sessions);
  app.use('/api/permission-requests', permissionRequests);
  app.use('/api/access-logs', accessLogsRouter);
  app.use('/api/audit-logs', auditLogsRouter);
  app.use('/api/deployments', deploymentsRouter);
  app.use('/api/gateways', gateways);
  app.use('/api/reports', reports);
  app.use('/api/users', users);
  app.use('/api/settings', settings);
  app.use('/api/notifications', notifications);
  app.get('/api/admin/ping', requirePermission('settings.manage'), (_req, res) => res.json({ ok: true }));
  app.use('/api', notFoundHandler);

  // Frontend statis (build Vite) + unduhan agent
  const dist = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
