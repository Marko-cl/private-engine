import { CurrentContext, FeedbackSummary, MemoryRecord, PreferenceRecord, Recommendation } from './shared/contracts';
import { emptyFeedbackSummary } from './feedback-engine';

export interface LLMRequest { systemPrompt: string; userPrompt: string; context: Pick<CurrentContext, 'category'|'topic'|'project'|'technologies'|'confidence'> | null; memories: Array<Pick<MemoryRecord, 'name'|'category'|'strength'|'confidence'|'evidenceCount'>>; preferences: Array<Pick<PreferenceRecord, 'name'|'category'|'strength'|'confidence'|'evidenceCount'|'trend'|'evidenceSummary'|'distinctDays'|'timePattern'|'projects'|'technologies'|'sourceTypes'|'projectContinuity'>>; recommendations: Array<Pick<Recommendation, 'title'|'category'|'reason'|'confidence'|'score'>>; feedback?: FeedbackSummary; }
export interface LLMResponse { content: string; confidence: number; provider: string; model: string; createdAt: string; }
export interface LLMProvider { generateResponse(request: LLMRequest): Promise<LLMResponse>; isConfigured(): boolean; status(): string; }

export interface LLMContextPayload { context: LLMRequest['context']; memories: LLMRequest['memories']; preferences: LLMRequest['preferences']; recommendations: LLMRequest['recommendations']; feedback: FeedbackSummary; }
export function buildLLMContext(context: CurrentContext | null, memories: MemoryRecord[], preferences: PreferenceRecord[], recommendations: Recommendation[], feedback?: FeedbackSummary): LLMContextPayload {
  return {
    context: context ? { category: context.category, topic: context.topic, project: context.project, technologies: context.technologies, confidence: context.confidence } : null,
    memories: memories.slice(0, 12).map(m => ({ name: m.name, category: m.category, strength: m.strength, confidence: m.confidence, evidenceCount: m.evidenceCount })),
    preferences: preferences.slice(0, 8).map(p => ({ name: p.name, category: p.category, strength: p.strength, confidence: p.confidence, evidenceCount: p.evidenceCount, distinctDays: p.distinctDays, trend: p.trend, evidenceSummary: p.evidenceSummary, timePattern: p.timePattern, projects: p.projects?.slice(0, 5), technologies: p.technologies?.slice(0, 8), sourceTypes: p.sourceTypes?.slice(0, 3), projectContinuity: p.projectContinuity })),
    recommendations: recommendations.slice(0, 8).map(r => ({ title: r.title, category: r.category, reason: r.reason, confidence: r.confidence, score: r.score })),
    feedback: feedback ?? emptyFeedbackSummary()
  };
}

export class ExternalLLMProvider implements LLMProvider {
  private endpoint: string; private apiKey: string; private model: string;
  constructor(config: { endpoint?: string; apiKey?: string; model?: string } = {}) { this.endpoint = config.endpoint ?? process.env.LLM_API_URL ?? 'https://api.openai.com/v1/chat/completions'; this.apiKey = config.apiKey ?? process.env.LLM_API_KEY ?? ''; this.model = config.model ?? process.env.LLM_MODEL ?? 'gpt-4o-mini'; }
  isConfigured() { return Boolean(this.apiKey); }
  status() { return this.isConfigured() ? 'configured' : 'not_configured'; }
  async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    if (!this.isConfigured()) throw new Error('LLM provider is not configured');
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20000);
    let response: Response;
    try { response = await fetch(this.endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` }, signal: controller.signal, body: JSON.stringify({ model: this.model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: request.systemPrompt }, { role: 'user', content: `${request.userPrompt}\n\nStructured context:\n${JSON.stringify({ context: request.context, memories: request.memories, preferences: request.preferences, recommendations: request.recommendations, feedback: request.feedback })}` }] }) }); } finally { clearTimeout(timeout); }
    if (!response.ok) throw new Error(`LLM provider returned HTTP ${response.status}`);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM provider returned no content');
    return { content, confidence: 0.5, provider: 'external', model: this.model, createdAt: new Date().toISOString() };
  }
}
