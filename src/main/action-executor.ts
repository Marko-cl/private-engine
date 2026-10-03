import { AgentActionRequest, PendingAgentAction } from '../shared/contracts';
import { PermissionManager } from './permission-manager';
import type { ActivityDatabase } from './database';
export interface ActionSystemOperations { openExternal(url: string): Promise<void>; openPath(path: string): Promise<string>; }
export class ActionExecutor {
  private operations: ActionSystemOperations;
  constructor(private permissions: PermissionManager, private db: ActivityDatabase, operations?: ActionSystemOperations) { this.operations = operations ?? { openExternal: async (url) => { const { shell } = require('electron') as typeof import('electron'); await shell.openExternal(url); }, openPath: async (value) => { const { shell } = require('electron') as typeof import('electron'); return shell.openPath(value); } }; }
  async execute(action: PendingAgentAction): Promise<{ status: string; error?: string }> {
    const current = this.db.getPendingAgentActions().find(item => item.id === action.id);
    if (current?.status === 'expired') return { status:'expired', error:'confirmation expired' };
    if (!current || current.status !== 'approved') { this.db.audit('action_failed', `${action.id}:${action.toolName}:not approved or already completed`); return { status:'rejected', error:'action is not approved or is already completed' }; }
    action = current;
    if (Date.now() >= Date.parse(action.expiresAt)) { this.db.setAgentActionStatus(action.id, 'expired'); this.db.audit('action_expired', `${action.id}:${action.toolName}`); return { status:'expired', error:'confirmation expired' }; }
    const validation = this.permissions.validateAction(action.request);
    if (!validation.ok) return this.fail(action, validation.reason);
    this.db.setAgentActionStatus(action.id, 'running'); this.db.audit('action_started', `${action.id}:${action.toolName}`);
    try { const args = action.request.arguments as Record<string, unknown>; if (action.toolName === 'open_url') await this.operations.openExternal(String(args.url)); else if (action.toolName === 'open_application') { const app = this.permissions.application(String(args.applicationId)); if (!app) throw new Error('application unavailable'); const error = await this.operations.openPath(app.path); if (error) throw new Error(error); } else if (action.toolName === 'open_approved_folder') { const folder = this.permissions.folder(String(args.folderId)); if (!folder) throw new Error('folder unavailable'); const error = await this.operations.openPath(folder.path); if (error) throw new Error(error); } else throw new Error('unsupported action'); this.db.setAgentActionStatus(action.id, 'completed'); this.db.audit('action_completed', `${action.id}:${action.toolName}`); return { status:'completed' }; } catch (error) { const message = error instanceof Error ? error.message : 'action failed'; this.db.setAgentActionStatus(action.id, 'failed'); this.db.audit('action_failed', `${action.id}:${action.toolName}:${message.slice(0,160)}`); return { status:'failed', error:message }; }
  }
  private fail(action: PendingAgentAction, reason: string) { this.db.setAgentActionStatus(action.id, 'failed'); this.db.audit('action_failed', `${action.id}:${action.toolName}:${reason}`); return { status:'failed', error:reason }; }
}
