import { ActivityDatabase } from './database';
import { PauseMode } from '../shared/contracts';

export class PrivacyManager {
  private mode: PauseMode = 'running';
  private pausedUntil: number | null = null;
  constructor(private db: ActivityDatabase) {}
  isTrackingAllowed(application?: string) {
    if (this.mode !== 'running' && !(this.mode === 'timed' && this.pausedUntil && Date.now() >= this.pausedUntil)) return false;
    if (this.mode === 'timed' && this.pausedUntil && Date.now() >= this.pausedUntil) { this.resume(); }
    return !application || !this.db.excludedApps().some(x => x.toLowerCase() === application.toLowerCase());
  }
  pause(minutes?: number) { this.mode = minutes ? 'timed' : 'paused'; this.pausedUntil = minutes ? Date.now() + minutes * 60_000 : null; this.db.audit('tracking_paused', minutes ? `${minutes} minutes` : 'until resumed'); }
  resume() { this.mode = 'running'; this.pausedUntil = null; this.db.audit('tracking_resumed'); }
  snapshot() { return { mode: this.mode, pausedUntil: this.pausedUntil }; }
}
