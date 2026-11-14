import { Router } from 'express';
import { db } from '../store/index.js';
import { requirePermission } from '../middleware/auth.js';
import { ah } from '../middleware/errors.js';
import { pageQuery } from '../validators/index.js';
import { jakartaToDate } from '../utils.js';
import { LOG_TYPES } from '../../shared/types.js';
import type { Where } from '../store/types.js';

export const accessLogsRouter = Router();
accessLogsRouter.get('/', requirePermission('logs.view'), ah(async (req, res) => {
  const { limit, cursor } = pageQuery.parse(req.query);
  const where: Where[] = [];
  if (typeof req.query.type === 'string' && (LOG_TYPES as readonly string[]).includes(req.query.type)) where.push(['type', '==', req.query.type]);
  for (const f of ['labId', 'deviceId', 'gatewayId', 'classId', 'sessionId', 'category'] as const) if (typeof req.query[f] === 'string' && req.query[f]) where.push([f, '==', req.query[f]]);
  if (typeof req.query.domain === 'string' && req.query.domain) where.push(['domain', '==', req.query.domain.toLowerCase()]);
  if (typeof req.query.from === 'string' && req.query.from) where.push(['ts', '>=', jakartaToDate(req.query.from, '00:00')]);
  if (typeof req.query.to === 'string' && req.query.to) where.push(['ts', '<=', jakartaToDate(req.query.to, '23:59')]);
  res.json(await db().list('accessLogs', { where, orderBy: { field: 'ts', dir: 'desc' }, limit, cursor }));
}));

export const auditLogsRouter = Router();
auditLogsRouter.get('/', requirePermission('audit.view'), ah(async (req, res) => {
  const { limit, cursor } = pageQuery.parse(req.query);
  const where: Where[] = [];
  if (typeof req.query.action === 'string' && req.query.action) where.push(['action', '==', req.query.action]);
  if (typeof req.query.userId === 'string' && req.query.userId) where.push(['userId', '==', req.query.userId]);
  if (typeof req.query.from === 'string' && req.query.from) where.push(['ts', '>=', jakartaToDate(req.query.from, '00:00')]);
  if (typeof req.query.to === 'string' && req.query.to) where.push(['ts', '<=', jakartaToDate(req.query.to, '23:59')]);
  res.json(await db().list('auditLogs', { where, orderBy: { field: 'ts', dir: 'desc' }, limit, cursor }));
}));

export const deploymentsRouter = Router();
deploymentsRouter.get('/', requirePermission('gateways.view'), ah(async (req, res) => {
  const { limit, cursor } = pageQuery.parse(req.query);
  const where: Where[] = [];
  if (typeof req.query.gatewayId === 'string' && req.query.gatewayId) where.push(['gatewayId', '==', req.query.gatewayId]);
  if (typeof req.query.status === 'string' && req.query.status) where.push(['status', '==', req.query.status]);
  res.json(await db().list('policyDeployments', { where, orderBy: { field: 'createdAt', dir: 'desc' }, limit, cursor }));
}));
