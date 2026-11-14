export type WhereOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains';
export type Where = [field: string, op: WhereOp, value: unknown];
export interface ListQuery { where?: Where[]; orderBy?: { field: string; dir?: 'asc' | 'desc' }; limit?: number; cursor?: string | null }
export type Doc = Record<string, any> & { id: string };

export const COLLECTIONS = [
  'users', 'students', 'classes', 'laboratories', 'devices', 'gateways', 'policies', 'policyRules', 'websiteCategories',
  'blockedDomains', 'allowedDomains', 'sessions', 'sessionDevices', 'permissionRequests', 'accessLogs', 'gatewayHeartbeats',
  'policyDeployments', 'auditLogs', 'systemSettings', 'notifications', 'agentNonces', 'gatewaySecrets', 'deviceCredentials', 'configBackups', 'dailyStats',
] as const;
export type Collection = (typeof COLLECTIONS)[number];

/** Abstraksi penyimpanan: Firestore (produksi) atau Memory+file JSON (DEMO/pengujian). */
export interface Store {
  readonly kind: 'firestore' | 'memory';
  get(col: Collection, id: string): Promise<Doc | null>;
  getMany(col: Collection, ids: string[]): Promise<Doc[]>;
  list(col: Collection, q?: ListQuery): Promise<{ items: Doc[]; nextCursor: string | null }>;
  count(col: Collection, where?: Where[]): Promise<number>;
  create(col: Collection, data: Record<string, any>, id?: string): Promise<Doc>;
  /** Membuat dokumen dengan ID tertentu; gagal (false) bila sudah ada — dipakai untuk anti-replay nonce. */
  createIfAbsent(col: Collection, id: string, data: Record<string, any>): Promise<boolean>;
  set(col: Collection, id: string, data: Record<string, any>): Promise<Doc>;
  update(col: Collection, id: string, patch: Record<string, any>): Promise<Doc | null>;
  delete(col: Collection, id: string): Promise<void>;
  deleteWhere(col: Collection, where: Where[], max?: number): Promise<number>;
  /** Penambahan atomik counter numerik (dot-path), membuat dokumen bila belum ada. */
  increment(col: Collection, id: string, fields: Record<string, number>, base?: Record<string, any>): Promise<void>;
}
