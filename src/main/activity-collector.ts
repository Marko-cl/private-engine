import activeWindow from 'active-win';
import { randomUUID } from 'node:crypto';
import { ActivitySummary } from '../shared/contracts';
import { ActivityDatabase } from './database';
import { PrivacyManager } from './privacy-manager';

export class ActivityCollector {
  private timer?: NodeJS.Timeout;
  private running = false;
  private sessionId?: string;
  private current: ActivitySummary | null = null;
  private latest: ActivitySummary | null = null;
  readonly available = process.platform === 'win32';
  constructor(private db: ActivityDatabase, private privacy: PrivacyManager) {}
  start() { if (!this.available || this.timer) return; this.running = true; this.sessionId = randomUUID(); this.db.startSession(this.sessionId, new Date().toISOString()); this.timer = setInterval(() => void this.sample(), 2500); void this.sample(); }
  stop() { this.running = false; if (this.timer) clearInterval(this.timer); this.timer = undefined; this.flush(); if (this.sessionId) this.db.endSession(this.sessionId, new Date().toISOString()); this.sessionId = undefined; }
  private async sample() {
    if (!this.running) return;
    if (!this.privacy.isTrackingAllowed()) { this.flush(); return; }
    const win = await activeWindow().catch(() => undefined);
    if (!win || !win.owner?.name) return;
    const appName = win.owner.name;
    if (!this.privacy.isTrackingAllowed(appName)) { this.flush(); return; }
    const titleEnabled = this.db.setting('titleCollection','true') === 'true';
    const title = titleEnabled ? (win.title || null) : null;
    const now = new Date();
    if (this.current && this.current.application === appName && this.current.title === title) { this.current.endedAt = now.toISOString(); this.current.durationSeconds = Math.max(1, Math.round((now.getTime() - Date.parse(this.current.startedAt))/1000)); this.latest = this.current; return; }
    this.flush();
    this.current = { id: randomUUID(), application: appName, title, startedAt: now.toISOString(), endedAt: now.toISOString(), durationSeconds: 0, sessionId: this.sessionId };
    this.latest = this.current;
  }
  private flush() { if (this.current && this.current.durationSeconds > 0 && this.privacy.isTrackingAllowed(this.current.application)) this.db.saveActivity(this.current); this.current = null; }
  currentActivity() { return this.latest; }
}
