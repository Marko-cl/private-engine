import { AgentActionRequest, AgentResponse, RecommendationType } from './shared/contracts';
import { AgentTool } from './agent-tools';

const TYPES: RecommendationType[] = ['continue_project','learn_topic','review_memory','productivity','explore_related'];
export function validateAgentResponses(value: unknown, tools: AgentTool[], sourceContext: string, onFailure?: (reason: string) => void): AgentResponse[] {
  const raw = Array.isArray(value) ? value : (value && typeof value === 'object' && Array.isArray((value as { responses?: unknown }).responses) ? (value as { responses: unknown[] }).responses : null);
  if (!raw) { onFailure?.('response is not an array or responses object'); return []; }
  const output: AgentResponse[] = [];
  for (const item of raw.slice(0, 5)) {
    if (!item || typeof item !== 'object') { onFailure?.('response item is not an object'); continue; }
    const r = item as Record<string, unknown>;
    if (typeof r.title !== 'string' || typeof r.explanation !== 'string') { onFailure?.('missing title or explanation'); continue; }
    const confidence = typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0.2;
    const suggestedTool = typeof r.suggestedTool === 'string' && tools.some(tool => tool.name === r.suggestedTool && tool.enabled && tool.permissionLevel !== 3) ? r.suggestedTool : null;
    if (typeof r.suggestedTool === 'string' && suggestedTool === null) onFailure?.('unknown or blocked tool rejected');
    const type = typeof r.type === 'string' && TYPES.includes(r.type as RecommendationType) ? r.type as RecommendationType : undefined;
    const action = validateAction(r.action, tools, sourceContext, r.explanation, onFailure);
    output.push({ id: `agent:llm:${output.length}:${safeSlug(r.title)}`, title: r.title.slice(0, 180), explanation: r.explanation.slice(0, 800), confidence, suggestedTool: action?.toolName ?? suggestedTool, requiresConfirmation: action !== undefined || (Boolean(r.requiresConfirmation) && suggestedTool !== null), sourceContext: sourceContext || 'structured local context', type, action });
  }
  return output;
}
function validateAction(value: unknown, tools: AgentTool[], sourceContext: string, reason: string, onFailure?: (reason: string) => void): AgentActionRequest | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) { onFailure?.('invalid action object'); return undefined; }
  const raw = value as Record<string, unknown>; const allowedKeys = new Set(['toolName','arguments']); if (Object.keys(raw).some(key => !allowedKeys.has(key))) { onFailure?.('action contains unauthorized fields'); return undefined; } const toolName = typeof raw.toolName === 'string' ? raw.toolName : '';
  const tool = tools.find(t => t.name === toolName);
  if (!tool || !tool.enabled || tool.permissionLevel !== 2) { onFailure?.('action tool is unknown, disabled, or not level 2'); return undefined; }
  if (!raw.arguments || typeof raw.arguments !== 'object' || Array.isArray(raw.arguments)) { onFailure?.('action arguments must be structured'); return undefined; }
  const args = raw.arguments as Record<string, unknown>; const expected = tool.argumentKeys ?? [];
  if (Object.keys(args).length !== expected.length || Object.keys(args).some(key => !expected.includes(key)) || Object.values(args).some(value => typeof value !== 'string' || value.length > 1000)) { onFailure?.('action arguments do not match tool schema'); return undefined; }
  return { toolName, arguments: args, permissionLevel: 2, requiresConfirmation: true, status: 'pending', sourceContext, reason, id: `agent-action:${safeSlug(toolName + JSON.stringify(args))}` };
}
function safeSlug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80); }
