export type DiagnosticSeverity = 'info' | 'warn' | 'error';
export interface DiagnosticEntry { component: string; severity: DiagnosticSeverity; code: string; at: string; durationMs?: number; }
export class Diagnostics {
  private entries: DiagnosticEntry[] = [];
  constructor(private capacity = 200) {}
  record(component: string, severity: DiagnosticSeverity, code: string, durationMs?: number) { const safeComponent = component.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40) || 'unknown'; const safeCode = code.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 80) || 'unknown'; this.entries.push({ component: safeComponent, severity, code: safeCode, at: new Date().toISOString(), ...(durationMs === undefined ? {} : { durationMs: Math.max(0, Math.round(durationMs)) }) }); if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity); }
  recent(limit = 20) { return this.entries.slice(-Math.max(1, Math.min(50, limit))); }
  status() { return { total: this.entries.length, errors: this.entries.filter(entry => entry.severity === 'error').length, warnings: this.entries.filter(entry => entry.severity === 'warn').length, recent: this.recent(10) }; }
}
