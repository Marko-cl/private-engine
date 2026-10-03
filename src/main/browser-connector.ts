import http from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export interface PairingRequest { id: string; extensionId: string; createdAt: string; }
interface ConnectorOptions { port?: number; loadTokenHash: () => string; saveTokenHash: (hash: string) => void; clearTokenHash: () => void; acceptPayload: (payload: unknown, token: string) => { accepted: boolean }; }
const MAX_BODY = 8192;
const MAX_REQUESTS_PER_MINUTE = 60;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export class BrowserConnectorServer {
  private server?: http.Server;
  private readonly pending = new Map<string, PairingRequest>();
  private readonly accepted = new Map<string, number[]>();
  private readonly fingerprints = new Map<string, number>();
  private lastAcceptedAt = 0;
  private revoked = false;
  constructor(private readonly options: ConnectorOptions) {}
  start(): Promise<void> { if (this.server) return Promise.resolve(); this.server = http.createServer((request, response) => void this.handle(request, response)); return new Promise((resolve, reject) => { this.server?.once('error', reject); this.server?.listen(this.options.port ?? 47631, '127.0.0.1', () => resolve()); }); }
  stop() { this.server?.close(); this.server = undefined; this.pending.clear(); this.accepted.clear(); this.fingerprints.clear(); }
  get pendingRequests(): PairingRequest[] { return [...this.pending.values()].filter(item => !item.id.startsWith('paired:')).map(item => ({ id: item.id, extensionId: item.extensionId, createdAt: item.createdAt })); }
  approve(id: string): boolean { const request = this.pending.get(id); if (!request) return false; this.revoked = false; const token = randomBytes(32).toString('hex'); this.options.saveTokenHash(hashToken(token)); this.pending.delete(id); (request as PairingRequest & { token?: string }).token = token; this.pending.set(`paired:${id}`, request as PairingRequest & { token: string }); return true; }
  revoke() { this.revoked = true; this.options.clearTokenHash(); for (const key of [...this.pending.keys()]) if (key.startsWith('paired:')) this.pending.delete(key); }
  connectionState(enabled: boolean) { if (!enabled) return 'disabled'; if (this.revoked) return 'revoked'; return Date.now() - this.lastAcceptedAt <= 5 * 60 * 1000 ? 'connected' : this.options.loadTokenHash() ? 'paired' : 'not_paired'; }
  private send(response: http.ServerResponse, status: number, body: unknown) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); }
  private async body(request: http.IncomingMessage): Promise<unknown | null> { let total = 0; const chunks: Buffer[] = []; for await (const chunk of request) { const part = Buffer.from(chunk as Buffer); total += part.length; if (total > MAX_BODY) return null; chunks.push(part); } try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; } }
  private validToken(value: string) { const stored = this.options.loadTokenHash(); if (!stored || !/^[a-f0-9]{64}$/.test(stored) || !/^[a-f0-9]{64}$/.test(hashToken(value))) return false; return timingSafeEqual(Buffer.from(stored), Buffer.from(hashToken(value))); }
  private rateLimited(token: string) { const now = Date.now(); const values = (this.accepted.get(token) ?? []).filter(item => now - item < 60000); if (values.length >= MAX_REQUESTS_PER_MINUTE) return true; values.push(now); this.accepted.set(token, values); return false; }
  private async handle(request: http.IncomingMessage, response: http.ServerResponse) {
    if (request.method === 'OPTIONS') { response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,authorization' }); response.end(); return; }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'POST' && url.pathname === '/pair-request') { const payload = await this.body(request); const extensionId = payload && typeof payload === 'object' && typeof (payload as any).extensionId === 'string' ? (payload as any).extensionId.slice(0, 80) : ''; if (!extensionId) return this.send(response, 400, { error: 'invalid_pair_request' }); const existing = [...this.pending.values()].find(item => item.extensionId === extensionId && !item.id.startsWith('paired:')); const item = existing ?? { id: randomUUID(), extensionId, createdAt: new Date().toISOString() }; this.pending.set(item.id, item); return this.send(response, 202, { requestId: item.id, status: 'pending' }); }
    if (request.method === 'GET' && url.pathname === '/pair-status') { const id = url.searchParams.get('requestId') ?? ''; const item = this.pending.get(`paired:${id}`); if (item && (item as any).token) { const token = (item as any).token; this.pending.delete(`paired:${id}`); return this.send(response, 200, { status: 'paired', token }); } return this.send(response, 200, { status: this.pending.has(id) ? 'pending' : 'unknown' }); }
    if (request.method === 'POST' && url.pathname === '/submit') { const auth = request.headers.authorization ?? ''; const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''; if (!this.validToken(token)) return this.send(response, 401, { error: 'unauthorized' }); if (this.rateLimited(token)) return this.send(response, 429, { error: 'rate_limited' }); const payload = await this.body(request); if (!payload) return this.send(response, 400, { error: 'invalid_payload' }); const now = Date.now(); const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex'); const previous = this.fingerprints.get(fingerprint); if (previous && now - previous < 30000) return this.send(response, 202, { accepted: false, duplicate: true }); this.fingerprints.set(fingerprint, now); for (const [key, at] of this.fingerprints) if (now - at > 60000) this.fingerprints.delete(key); if (this.fingerprints.size > 256) this.fingerprints.delete(this.fingerprints.keys().next().value as string); const result = this.options.acceptPayload(payload, token); if (result.accepted) this.lastAcceptedAt = now; return this.send(response, result.accepted ? 202 : 400, result); }
    this.send(response, 404, { error: 'not_found' });
  }
}
