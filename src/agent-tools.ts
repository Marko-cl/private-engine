export type PermissionLevel = 0 | 1 | 2 | 3;
export type AgentToolName = 'get_current_context' | 'get_memory' | 'get_preferences' | 'get_recent_activity_summary' | 'open_url' | 'open_application' | 'open_approved_folder';
export interface AgentTool { name: AgentToolName; description: string; permissionLevel: PermissionLevel; enabled: boolean; readOnly: boolean; argumentKeys?: string[]; }
export const AGENT_TOOLS: AgentTool[] = [
  { name: 'get_current_context', description: 'Read the current structured context.', permissionLevel: 0, enabled: true, readOnly: true },
  { name: 'get_memory', description: 'Read one existing structured memory.', permissionLevel: 0, enabled: true, readOnly: true },
  { name: 'get_preferences', description: 'Read learned preference summaries.', permissionLevel: 0, enabled: true, readOnly: true },
  { name: 'get_recent_activity_summary', description: 'Read a summarized recent activity record.', permissionLevel: 0, enabled: true, readOnly: true },
  { name: 'open_url', description: 'Open a validated HTTP or HTTPS URL after confirmation.', permissionLevel: 2, enabled: true, readOnly: false, argumentKeys: ['url'] },
  { name: 'open_application', description: 'Open one application from the trusted application allowlist after confirmation.', permissionLevel: 2, enabled: true, readOnly: false, argumentKeys: ['applicationId'] },
  { name: 'open_approved_folder', description: 'Open one configured approved folder after confirmation.', permissionLevel: 2, enabled: true, readOnly: false, argumentKeys: ['folderId'] },
];
export const FORBIDDEN_AGENT_TOOLS = ['execute_command','open_file','browse_web','edit_file','delete_file','powershell'] as const;
export function enabledAgentTools(tools: AgentTool[] = AGENT_TOOLS) { return tools.filter(tool => tool.enabled && tool.permissionLevel !== 3); }
export function readOnlyAgentTools(tools: AgentTool[] = AGENT_TOOLS) { return enabledAgentTools(tools).filter(tool => tool.permissionLevel === 0 && tool.readOnly); }
