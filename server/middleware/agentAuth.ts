import type { NextFunction, Request, Response } from 'express';
import { db } from '../store/index.js';
import { HttpError, decrypt, hmacHex, safeEqual, sha256 } from '../utils.js';
import { getSettings } from '../services/settings.js';

// Autentikasi Gateway Agent:
//   Authorization: Gateway <gatewayId>
//   X-LG-Timestamp: <unix detik>   X-LG-Nonce: <acak ≥16 char>
//   X-LG-Signature: hex(HMAC-SHA256(secret, ts + "\n" + nonce + "\n" + METHOD + "\n" + path + "\n" + sha256(body)))
// Pencegahan replay: jendela waktu ± maxClockSkewSec + nonce unik per gateway (disimpan di agentNonces).
export function signatureBase(ts: string, nonce: string, method: string, path: string, body: string) {
  return `${ts}\n${nonce}\n${method.toUpperCase()}\n${path}\n${sha256(body)}`;
}

export async function requireGateway(req: Request, _res: Response, next: NextFunction) {
  try {
    const auth = req.headers.authorization ?? '';
    const m = auth.match(/^Gateway ([A-Za-z0-9_-]{1,128})$/);
    const ts = String(req.headers['x-lg-timestamp'] ?? '');
    const nonce = String(req.headers['x-lg-nonce'] ?? '');
    const sig = String(req.headers['x-lg-signature'] ?? '');
    if (!m || !/^\d{10}$/.test(ts) || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(sig)) throw new HttpError(401, 'Header autentikasi gateway tidak lengkap', 'GATEWAY_AUTH');
    const gwId = m[1];
    const settings = await getSettings();
    if (Math.abs(Date.now() / 1000 - Number(ts)) > settings.gateway.maxClockSkewSec) throw new HttpError(401, 'Timestamp di luar jendela waktu (periksa NTP gateway)', 'CLOCK_SKEW');
    const [gw, sec] = await Promise.all([db().get('gateways', gwId), db().get('gatewaySecrets', gwId)]);
    if (!gw || !sec?.secretEnc || gw.status !== 'PAIRED') throw new HttpError(401, 'Gateway tidak terdaftar, belum dipasangkan, atau telah dicabut', 'GATEWAY_REVOKED');
    const secret = decrypt(sec.secretEnc);
    const raw = (req as any).rawBody ?? '';
    const expected = hmacHex(secret, signatureBase(ts, nonce, req.method, req.originalUrl.split('?')[0], raw));
    if (!safeEqual(expected, sig)) throw new HttpError(401, 'Tanda tangan permintaan tidak valid', 'BAD_SIGNATURE');
    const fresh = await db().createIfAbsent('agentNonces', `${gwId}_${nonce}`, { gatewayId: gwId, expiresAt: new Date(Date.now() + 2 * settings.gateway.maxClockSkewSec * 1000) });
    if (!fresh) throw new HttpError(401, 'Permintaan berulang terdeteksi (replay)', 'REPLAY');
    req.gateway = { id: gw.id, name: gw.name, labIds: gw.labIds ?? [] };
    next();
  } catch (e) { next(e); }
}

// Autentikasi perangkat: Authorization: Device <deviceId>:<token>
export async function requireDevice(req: Request, _res: Response, next: NextFunction) {
  try {
    const m = (req.headers.authorization ?? '').match(/^Device ([A-Za-z0-9_-]{1,128}):([A-Za-z0-9_-]{20,128})$/);
    if (!m) throw new HttpError(401, 'Kredensial perangkat tidak ada', 'DEVICE_AUTH');
    const [, id, token] = m;
    const [dev, cred] = await Promise.all([db().get('devices', id), db().get('deviceCredentials', id)]);
    if (!dev || !cred || cred.revoked || !safeEqual(cred.tokenHash, sha256(token))) throw new HttpError(401, 'Kredensial perangkat tidak valid atau dicabut', 'DEVICE_AUTH');
    if (dev.status !== 'active') throw new HttpError(403, 'Perangkat dinonaktifkan', 'DEVICE_DISABLED');
    req.device = { id };
    next();
  } catch (e) { next(e); }
}
