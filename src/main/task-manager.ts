export interface ManagedTaskStatus { name: string; running: boolean; failures: number; lastErrorCode?: string; lastRunAt?: string; }
interface TaskDefinition { name: string; intervalMs: number; run: () => Promise<void> | void; timer?: NodeJS.Timeout; running: boolean; failures: number; lastErrorCode?: string; lastRunAt?: string; }
export class TaskManager {
  private tasks = new Map<string, TaskDefinition>();
  constructor(private report: (component: string, code: string) => void = () => {}) {}
  register(name: string, intervalMs: number, run: () => Promise<void> | void) { if (this.tasks.has(name)) return false; this.tasks.set(name, { name, intervalMs: Math.max(1000, intervalMs), run, running: false, failures: 0 }); return true; }
  start(name: string) { const task = this.tasks.get(name); if (!task || task.timer) return false; task.timer = setInterval(() => void this.execute(task), task.intervalMs); void this.execute(task); return true; }
  startAll() { for (const name of this.tasks.keys()) this.start(name); }
  stop(name: string) { const task = this.tasks.get(name); if (!task) return false; if (task.timer) clearInterval(task.timer); task.timer = undefined; return true; }
  stopAll() { for (const task of this.tasks.values()) { if (task.timer) clearInterval(task.timer); task.timer = undefined; } }
  async executeNow(name: string) { const task = this.tasks.get(name); if (task) await this.execute(task); }
  status(): ManagedTaskStatus[] { return [...this.tasks.values()].map(task => ({ name: task.name, running: Boolean(task.timer) || task.running, failures: task.failures, lastErrorCode: task.lastErrorCode, lastRunAt: task.lastRunAt })); }
  private async execute(task: TaskDefinition) { if (task.running) return; task.running = true; task.lastRunAt = new Date().toISOString(); try { await task.run(); task.lastErrorCode = undefined; } catch { task.failures++; task.lastErrorCode = 'task_failed'; this.report(task.name, 'task_failed'); } finally { task.running = false; } }
}
