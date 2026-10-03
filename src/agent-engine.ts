import { AgentTool, AgentToolName, enabledAgentTools } from './agent-tools';
import { CurrentContext, FeedbackSummary, MemoryRecord, PreferenceRecord, Recommendation, AgentResponse, PendingAgentAction, AgentActionRequest } from './shared/contracts';
import { AGENT_SYSTEM_PROMPT } from './agent-system-prompt';
import { buildLLMContext, LLMProvider } from './llm-provider';
import { validateAgentResponses } from './agent-validation';

export class AgentEngine {
  generate(context: CurrentContext | null, memories: MemoryRecord[] = [], preferences: PreferenceRecord[] = [], recommendations: Recommendation[] = [], tools: AgentTool[] = [], createdAt = new Date().toISOString()): AgentResponse[] {
    if (!context) return [];
    const available = enabledAgentTools(tools);
    const responses: AgentResponse[] = [];
    const preferred = preferences.filter(p => this.matches(p.name, p.category, context)).sort((a,b) => b.strength - a.strength)[0];
    const recommendation = recommendations[0];
    const readTool = this.chooseTool(available, recommendation?.title.includes(context.topic ?? '') ? 'get_current_context' : 'get_memory');
    if (preferred && readTool) responses.push({ id: `agent:preference:${this.slug(preferred.name)}`, title: `Review your ${preferred.name} activity`, explanation: `Based on repeated activity and a strong ${preferred.category || context.category} preference, this may be useful to review.`, confidence: this.bound(preferred.confidence * .7 + context.confidence * .3), suggestedTool: readTool, requiresConfirmation: false, sourceContext: this.source(context) });
    if (recommendation) {
      const tool = this.chooseTool(available, 'get_current_context');
      if (tool) responses.push({ id: `agent:recommendation:${recommendation.id}`, title: `Consider: ${recommendation.title}`, explanation: `This suggestion is related to your current ${context.topic ?? context.category} context. It remains a suggestion and no action will be taken.`, confidence: this.bound(recommendation.confidence * .7 + context.confidence * .3), suggestedTool: tool, requiresConfirmation: false, sourceContext: this.source(context) });
    }
    const memory = memories.filter(m => this.matches(m.name, m.category, context)).sort((a,b) => b.strength - a.strength)[0];
    const tool = this.chooseTool(available, 'get_memory');
    if (memory && tool && !responses.some(r => r.title.includes(memory.name))) responses.push({ id: `agent:memory:${this.slug(memory.name)}`, title: `Review ${memory.name}`, explanation: `This is a recurring structured memory related to your current context; the assistant can only read it.`, confidence: this.bound(memory.confidence * .7 + context.confidence * .3), suggestedTool: tool, requiresConfirmation: false, sourceContext: this.source(context) });
    return responses.slice(0, 3);
  }
  async generateWithLLM(context: CurrentContext | null, memories: MemoryRecord[], preferences: PreferenceRecord[], recommendations: Recommendation[], tools: AgentTool[], provider?: LLMProvider, createdAt = new Date().toISOString(), onValidationFailure?: (reason: string) => void, feedback?: FeedbackSummary): Promise<AgentResponse[]> {
    const fallback = () => this.generate(context, memories, preferences, recommendations, tools, createdAt);
    if (!context || !provider || !provider.isConfigured()) return fallback();
    const structured = buildLLMContext(context, memories, preferences, recommendations, feedback);
    try {
      const result = await provider.generateResponse({ systemPrompt: AGENT_SYSTEM_PROMPT, userPrompt: `Provide concise, grounded assistant suggestions. Do not perform or claim actions. Available tools: ${enabledAgentTools(tools).map(tool => `${tool.name}(${(tool.argumentKeys ?? []).join(',')})`).join(', ')}`,  context: structured.context, memories: structured.memories, preferences: structured.preferences, recommendations: structured.recommendations });
      let parsed: unknown;
      try { parsed = JSON.parse(result.content.replace(/^```json\\s*|\\s*```$/g, '')); } catch { onValidationFailure?.('malformed JSON response'); return fallback(); }
      const validated = validateAgentResponses(parsed, enabledAgentTools(tools), this.source(context), onValidationFailure);
      return validated.length ? validated : fallback();
    } catch (error) { onValidationFailure?.(error instanceof Error ? error.message : 'provider failure'); return fallback(); }
  }

  createConfirmationRequest(toolName: string, request: string, createdAt = new Date().toISOString()): PendingAgentAction | null { const tool = enabledAgentTools().find(item => item.name === toolName); if (!tool || !request.trim() || request.length > 500) return null; const expiresAt = new Date(Date.parse(createdAt) + 300000).toISOString(); const id = `agent-action:${this.slug(toolName + ':' + request)}`; return { id, toolName, request: request.trim() as unknown as AgentActionRequest, status: 'pending', createdAt, expiresAt, sourceContext: 'legacy controlled suggestion', reason: request }; }
  approveConfirmation(action: PendingAgentAction): PendingAgentAction { return { ...action, status: 'approved' }; }
  rejectConfirmation(action: PendingAgentAction): PendingAgentAction { return { ...action, status: 'rejected' }; }
  private chooseTool(tools: AgentTool[], preferred: AgentToolName) { return tools.find(tool => tool.name === preferred)?.name ?? tools[0]?.name ?? null; }
  private matches(name: string, category: string, context: CurrentContext) { const terms = [context.topic, context.subtopic, context.project, context.category, ...context.technologies].filter(Boolean).map(x => String(x).toLowerCase()); const value = `${name} ${category}`.toLowerCase(); return terms.some(term => value.includes(term) || term.includes(value)); }
  private source(context: CurrentContext) { return [context.category, context.topic, context.subtopic, context.project].filter(Boolean).join(' / '); }
  private slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120); }
  private bound(value: number) { return Math.min(.99, Math.max(.2, value)); }
}
