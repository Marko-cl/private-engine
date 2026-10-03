import { AgentActionRequest } from '../shared/contracts';
import { AGENT_TOOLS, AgentTool, PermissionLevel } from '../agent-tools';

export interface ApprovedFolder { id: string; label: string; path: string; }
export interface AllowedApplication { id: string; label: string; path: string; }
export class PermissionManager {
  private tools: AgentTool[];
  private applications: AllowedApplication[];
  private folders: ApprovedFolder[];
  constructor(tools: AgentTool[] = AGENT_TOOLS, config: { applications?: AllowedApplication[]; folders?: ApprovedFolder[] } = {}) { this.tools = tools.map(tool => ({ ...tool })); const fixedIds = new Set(['vscode','godot','discord','steam']); this.applications = (config.applications ?? []).filter(app => fixedIds.has(app.id) && typeof app.path === 'string'); this.folders = (config.folders ?? []).filter(folder => typeof folder.id === 'string' && typeof folder.path === 'string'); }
  getTools() { return this.tools.map(tool => ({ ...tool })); }
  getTool(name: string) { return this.tools.find(tool => tool.name === name); }
  canUse(name: string) { const tool = this.getTool(name); return Boolean(tool && tool.enabled && tool.permissionLevel !== 3); }
  validateAction(request: AgentActionRequest) {
    const tool = this.getTool(request.toolName);
    if (!tool || !tool.enabled || tool.permissionLevel === 3) return { ok: false as const, reason: 'tool is unknown, disabled, or blocked' };
    if (tool.permissionLevel < 2 || !request.requiresConfirmation) return { ok: false as const, reason: 'action requires a level-2 confirmation' };
    if (!request.arguments || typeof request.arguments !== 'object' || Array.isArray(request.arguments)) return { ok: false as const, reason: 'arguments must be structured data' };
    const keys = Object.keys(request.arguments);
    if (keys.some(key => !tool.argumentKeys?.includes(key)) || keys.length !== tool.argumentKeys?.length) return { ok: false as const, reason: 'unexpected or missing arguments' };
    const args = request.arguments as Record<string, unknown>;
    if (request.toolName === 'open_url') { try { const url = new URL(String(args.url)); if (!['http:','https:'].includes(url.protocol)) return { ok:false as const, reason:'only http and https URLs are allowed' }; } catch { return { ok:false as const, reason:'malformed URL' }; } }
    if (request.toolName === 'open_application' && !this.applications.some(app => app.id === args.applicationId)) return { ok:false as const, reason:'application is not allowlisted' };
    if (request.toolName === 'open_approved_folder' && !this.folders.some(folder => folder.id === args.folderId)) return { ok:false as const, reason:'folder is not approved' };
    return { ok: true as const, tool, permissionLevel: tool.permissionLevel as PermissionLevel };
  }
  application(id: string) { return this.applications.find(app => app.id === id); }
  folder(id: string) { return this.folders.find(folder => folder.id === id); }
}
