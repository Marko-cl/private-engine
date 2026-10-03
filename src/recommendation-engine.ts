import { ActivitySummary, CurrentContext, FeedbackSummary, Goal, MemoryRecord, PreferenceRecord, Recommendation, RecommendationType } from './shared/contracts';
import { emptyFeedbackSummary, feedbackAdjustment } from './feedback-engine';

export class RecommendationEngine {
  generate(context: CurrentContext | null, memories: MemoryRecord[] = [], preferences: PreferenceRecord[] = [], recent: ActivitySummary[] = [], feedbackOrCreatedAt: FeedbackSummary | string = emptyFeedbackSummary(), createdAt = new Date().toISOString(), semanticRelevance = 0, goals: Goal[] = [], minimumScore = 28): Recommendation[] {
    if (!context) return [];
    const feedback = typeof feedbackOrCreatedAt === 'string' ? emptyFeedbackSummary() : feedbackOrCreatedAt;
    if (typeof feedbackOrCreatedAt === 'string') createdAt = feedbackOrCreatedAt;
    const candidates: Recommendation[] = [];
    const sourceContext = [context.category, context.topic, context.subtopic, context.project].filter(Boolean).join(' / ');
    const matchingPreferences = preferences.filter(p => this.matches(p.name, p.category, context));
    const matchingMemories = memories.filter(m => this.matches(m.name, m.category, context));
    const prefStrength = this.maxValue(matchingPreferences.map(p => p.strength));
    const prefConfidence = this.maxValue(matchingPreferences.map(p => p.confidence));
    const memoryStrength = this.maxValue(matchingMemories.map(m => m.strength));
    const memoryConfidence = this.maxValue(matchingMemories.map(m => m.confidence));
    const recency = this.recency(recent, Date.parse(createdAt));
    const repeatedInterest = this.maxValue([...matchingPreferences.map(p => Math.min(1, p.evidenceCount / 5)), ...matchingMemories.map(m => Math.min(1, m.evidenceCount / 5))]);
    const contextMatch = context.confidence;
    const projectRelevance = context.project ? 1 : 0;
    const add = (type: RecommendationType, title: string, description: string, category: string, reason: string, values: { context?: number; preference?: number; memory?: number; recent?: number; project?: number; repeated?: number } = {}) => {
      const baseScore = this.score({ context: values.context ?? contextMatch, preference: values.preference ?? prefStrength, memory: values.memory ?? memoryStrength, recent: values.recent ?? recency, project: values.project ?? projectRelevance, repeated: values.repeated ?? repeatedInterest });
      const adjustment = feedbackAdjustment(feedback, { type, category, topic: context.topic, project: context.project });
      const semanticAdjustment = Math.max(0, Math.min(4, Number.isFinite(semanticRelevance) ? semanticRelevance * 4 : 0));
      const goalRelevance = goals.some(goal => goal.status === 'active' && `${goal.title} ${goal.category} ${goal.associations.projects.join(' ')} ${goal.associations.technologies.join(' ')}`.toLowerCase().includes(`${context.topic ?? ''} ${context.project ?? ''}`.trim().toLowerCase())) ? 3 : 0;
      const score = Math.round(Math.min(100, Math.max(0, baseScore + adjustment + semanticAdjustment + goalRelevance)));
      if (score < minimumScore) return;
      const confidence = Math.min(0.99, Math.max(0.2, context.confidence * 0.4 + prefConfidence * 0.25 + memoryConfidence * 0.2 + recency * 0.15));
      const signals = ['Current context']; if ((values.preference ?? 0) > 0) signals.push('Preference'); if ((values.memory ?? 0) > 0) signals.push('Memory'); if ((values.recent ?? 0) > 0) signals.push('Recency'); if ((semanticRelevance > 0)) signals.push('Semantic support'); if (goals.some(goal => goal.status === 'active' && (goal.category === context.category || goal.associations.projects.includes(context.project ?? '') || goal.associations.technologies.some(t => context.technologies.includes(t))))) signals.push('Active goal'); if (adjustment !== 0) signals.push('Feedback'); candidates.push({ id: `recommendation:${type}:${this.slug(title)}`, type, title, description, category, reason, confidence, score, createdAt, sourceContext, topic: context.topic, project: context.project, signals });
    };
    const preferenceEvidence = matchingPreferences[0]?.evidenceSummary ? ` Evidence: ${matchingPreferences[0].evidenceSummary}.` : '';
    if (context.project) add('continue_project', `Continue working on ${context.project}`, `Return to your recent ${context.category} project.`, context.category, `Based on recent ${context.project} activity and the current ${context.topic ?? context.category} context.${preferenceEvidence}`, { project: 1, repeated: Math.max(repeatedInterest, .4) });
    if (context.topic) add('learn_topic', `Learn more about ${context.subtopic ?? context.topic}`, `Explore a deeper part of your current ${context.topic} work.`, 'Learning', `Related to your recent work with ${context.topic}${context.subtopic ? ` and ${context.subtopic}` : ''}.${preferenceEvidence}`);
    const review = matchingMemories.filter(m => m.name.toLowerCase() !== (context.topic ?? '').toLowerCase() && m.type !== 'related').sort((a,b) => b.strength - a.strength)[0];
    if (review) add('review_memory', `Review your previous ${review.name} work`, `Reconnect with a topic already present in your activity history.`, review.category || context.category, `Frequently observed in your stored activity and related to ${context.topic ?? context.category}.`, { memory: review.strength, repeated: Math.min(1, review.evidenceCount / 4) });
    const related = memories.filter(m => m.type === 'related' && !this.matches(m.name, m.category, context)).sort((a,b) => b.strength - a.strength)[0];
    if (related) add('explore_related', `Explore ${related.name}`, `This is a locally defined related concept, not an external recommendation.`, related.category || context.category, `Related to your recurring ${context.topic ?? context.category} activity through the local knowledge map.`, { memory: related.strength, repeated: Math.min(1, related.evidenceCount / 4) });
    const minutes = recent.reduce((sum, a) => sum + a.durationSeconds, 0) / 60;
    if (minutes >= 45) add('productivity', 'Take a short break', 'You have spent substantial recent time in one activity context.', 'Productivity', `Based on approximately ${Math.round(minutes)} minutes of recent activity in the current context.`, { context: .8, preference: 0, memory: 0, recent: 1, project: 0, repeated: .5 });
    const recentTitles = new Set(recent.map(a => `${a.application}:${a.title ?? ''}`.toLowerCase()).slice(0, 20)); const diverse = this.unique(candidates).filter(item => !recentTitles.has(item.title.toLowerCase())).sort((a,b) => b.score - a.score); const categories = new Set<string>(); const projects = new Set<string>(); return diverse.filter(item => { const categoryOk = categories.has(item.category) ? categories.size < 3 : true; const projectKey = item.project ?? ''; const projectOk = projectKey ? !projects.has(projectKey) || projects.size < 3 : true; if(categoryOk) categories.add(item.category); if(projectOk && projectKey) projects.add(projectKey); return categoryOk && projectOk; }).slice(0, 5);
  }
  deleteRecommendation(recommendations: Recommendation[], id: string) { return recommendations.filter(item => item.id !== id); }
  clearRecommendations() { return []; }
  score(values: { context: number; preference: number; memory: number; recent: number; project: number; repeated: number }): number { const base = values.context * .35 + values.preference * .30 + values.memory * .20 + values.recent * .15; const boost = values.project * .04 + values.repeated * .04; return Math.round(Math.min(100, Math.max(0, (base + boost) * 100))); }
  private matches(name: string, category: string, context: CurrentContext) { const terms = [context.topic, context.subtopic, context.project, context.category, ...context.technologies].filter(Boolean).map(x => String(x).toLowerCase()); const value = `${name} ${category}`.toLowerCase(); return terms.some(term => value.includes(term) || term.includes(value)); }
  private recency(activities: ActivitySummary[], now: number) { if (!activities.length || !Number.isFinite(now)) return 0; const newest = Math.max(...activities.map(a => Date.parse(a.endedAt ?? a.startedAt))); return Math.max(.2, Math.min(1, 1 - (now - newest) / (7 * 86400000))); }
  private maxValue(values: number[]) { return values.length ? Math.max(...values) : 0; }
  private slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  private unique(items: Recommendation[]) { const seen = new Set<string>(); return items.filter(item => { const key = item.title.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; }); }
}
