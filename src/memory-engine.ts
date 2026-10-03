import { CurrentContext, MemoryRecord } from './shared/contracts';
import { MEMORY_RELATIONSHIPS, MemoryRelationship } from './memory-relationships';
import { canonicalMemoryConcept as canonicalConcept } from './memory-canonicalization';

export interface MemoryObservation { context: CurrentContext; observedAt: string; durationSeconds: number; sessionId?: string; }
export interface MemoryEngineOptions { halfLifeDays?: number; relationships?: MemoryRelationship[]; }

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export class MemoryEngine {
  private halfLifeDays: number;
  private relationships: MemoryRelationship[];
  constructor(options: MemoryEngineOptions = {}) { this.halfLifeDays = options.halfLifeDays ?? 90; this.relationships = options.relationships ?? MEMORY_RELATIONSHIPS; }

  update(existing: MemoryRecord[], observation: MemoryObservation): MemoryRecord[] {
    const now = Date.parse(observation.observedAt);
    const memories = existing.map(memory => this.decay({ ...memory }, now));
    const evidence = this.evidence(observation.context);
    const directNames = new Set(evidence.map(item => item.name.toLowerCase()));
    for (const item of evidence) this.reinforce(memories, item.name, item.type, item.category, observation, item.source, 1);
    for (const item of evidence) {
      const relationship = this.relationships.find(r => r.name.toLowerCase() === item.name.toLowerCase());
      for (const related of relationship?.related ?? []) if (!directNames.has(related.toLowerCase())) this.reinforce(memories, related, 'related', relationship?.category ?? observation.context.category, observation, `related to ${item.name}`, 0.18);
    }
    return memories;
  }

  decay(memory: MemoryRecord, now = Date.now()): MemoryRecord {
    const ageDays = Math.max(0, (now - Date.parse(memory.lastSeen)) / 86400000);
    const factor = Math.pow(0.5, ageDays / this.halfLifeDays);
    return { ...memory, strength: clamp(memory.strength * factor), confidence: clamp(memory.confidence * (0.92 + 0.08 * factor)) };
  }

  getRecentMemories(memories: MemoryRecord[], since: string): MemoryRecord[] { const timestamp = Date.parse(since); return memories.filter(m => Date.parse(m.lastSeen) >= timestamp).sort((a,b) => b.lastSeen.localeCompare(a.lastSeen)); }
  getRelevantMemories(memories: MemoryRecord[], topic: string): MemoryRecord[] { const q = topic.toLowerCase(); return memories.filter(m => m.name.toLowerCase().includes(q) || m.category.toLowerCase().includes(q) || m.metadataJson.toLowerCase().includes(q)).sort((a,b) => b.strength - a.strength); }
  getProjectMemories(memories: MemoryRecord[], project: string): MemoryRecord[] { return memories.filter(m => m.type === 'project' && m.name.toLowerCase() === project.toLowerCase()).sort((a,b) => b.strength - a.strength); }
  getMemory(memories: MemoryRecord[], name: string): MemoryRecord | null { return memories.find(m => m.name.toLowerCase() === name.toLowerCase()) ?? null; }
  deleteMemory(memories: MemoryRecord[], id: string): MemoryRecord[] { return memories.filter(m => m.id !== id); }
  retain(memories: MemoryRecord[], retention: string, now = Date.now()): MemoryRecord[] { const days = retention === '30 days' ? 30 : retention === '1 year' ? 365 : retention === 'Forever' ? null : 90; return days === null ? memories : memories.filter(m => now - Date.parse(m.lastSeen) <= days * 86400000); }

  private evidence(context: CurrentContext) {
    const result: { name: string; type: MemoryRecord['type']; category: string; source: string }[] = [];
    const seen = new Set<string>();
    const add = (item: { name: string; type: MemoryRecord['type']; category: string; source: string }) => { if (!seen.has(item.name.toLowerCase())) { seen.add(item.name.toLowerCase()); result.push(item); } };
    if (context.category) add({ name: canonicalConcept(context.category), type: 'category', category: context.category, source: 'current context category' });
    if (context.topic) add({ name: canonicalConcept(context.topic), type: 'topic', category: context.category, source: 'current context topic' });
    if (context.subtopic) add({ name: canonicalConcept(context.subtopic), type: 'subtopic', category: context.category, source: 'current context subtopic' });
    if (context.project) add({ name: context.project.slice(0, 120), type: 'project', category: context.category, source: 'current context project' });
    for (const technology of context.technologies) add({ name: canonicalConcept(technology), type: 'technology', category: context.category, source: 'current context technology' });
    return result;
  }

  private reinforce(memories: MemoryRecord[], name: string, type: MemoryRecord['type'], category: string, observation: MemoryObservation, source: string, weight: number) {
    const canonicalName = canonicalConcept(name); const existing = memories.find(m => canonicalConcept(m.name).toLowerCase() === canonicalName.toLowerCase());
    const metadata = existing ? safeJson(existing.metadataJson) : {}; const eventKey = observation.sessionId ?? `${observation.observedAt.slice(0, 10)}:${canonicalName.toLowerCase()}`; const sessions = Array.isArray(metadata.evidenceSessions) ? metadata.evidenceSessions.filter(item => typeof item === 'string') as string[] : []; const grouped = Boolean(observation.sessionId && sessions.includes(eventKey)); const effectiveWeight = grouped ? Math.min(weight, .2) : weight; const seconds = Math.max(0, observation.durationSeconds * effectiveWeight);
    if (existing) {
      const priorEvidence = existing.evidenceCount;
      existing.strength = clamp(existing.strength + (0.12 * effectiveWeight) * (1 - existing.strength) + Math.min(.04, seconds / 72000));
      const distinctDays = Array.isArray(metadata.observedDays) ? new Set(metadata.observedDays.filter(item => typeof item === 'string')).size : 1;
      const sourceCount = Array.isArray(metadata.sourceTypes) ? new Set(metadata.sourceTypes).size : 1;
      existing.confidence = clamp(1 - Math.exp(-((priorEvidence + effectiveWeight) / 4)) * (1 - Math.min(.15, distinctDays / 100 + sourceCount / 100)));
      existing.name = canonicalName; existing.lastSeen = observation.observedAt; existing.evidenceCount = Math.min(10000, existing.evidenceCount + effectiveWeight); existing.totalSeconds = Math.min(100000000, existing.totalSeconds + seconds); existing.category = category || existing.category; existing.source = source; existing.metadataJson = JSON.stringify(recordStructuredEvidence(metadata, observation, effectiveWeight, source));
    } else {
      memories.push({ id: `memory:${canonicalName.toLowerCase()}`, type, name: canonicalName, category, strength: clamp(0.18 + 0.12 * effectiveWeight), confidence: clamp(1 - Math.exp(-effectiveWeight / 4)), firstSeen: observation.observedAt, lastSeen: observation.observedAt, evidenceCount: effectiveWeight, totalSeconds: seconds, source, metadataJson: JSON.stringify(recordStructuredEvidence({}, observation, effectiveWeight, source)) });
    }
  }
}
function safeJson(value: string): Record<string, unknown> { try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
function recordStructuredEvidence(metadata: Record<string, unknown>, observation: MemoryObservation, weight: number, source: string) {
  const context = observation.context; const date = observation.observedAt.slice(0, 10); const parsed = new Date(observation.observedAt); const hour = parsed.getUTCHours(); const bucket = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'; const day = parsed.getUTCDay();
  const observedDays = Array.isArray(metadata.observedDays) ? metadata.observedDays.filter(item => typeof item === 'string') as string[] : []; if (!observedDays.includes(date)) observedDays.push(date); metadata.observedDays = observedDays.slice(-180);
  const dailyEvidence = metadata.dailyEvidence && typeof metadata.dailyEvidence === 'object' ? metadata.dailyEvidence as Record<string, number> : {}; dailyEvidence[date] = Math.min(1000, (dailyEvidence[date] ?? 0) + weight); const dates = Object.keys(dailyEvidence).sort().slice(-180); metadata.dailyEvidence = Object.fromEntries(dates.map(key => [key, dailyEvidence[key]]));
  const timeBuckets = metadata.timeBuckets && typeof metadata.timeBuckets === 'object' ? metadata.timeBuckets as Record<string, number> : {}; timeBuckets[bucket] = (timeBuckets[bucket] ?? 0) + weight; metadata.timeBuckets = timeBuckets;
  metadata.weekdayEvidence = (Number(metadata.weekdayEvidence) || 0) + (day >= 1 && day <= 5 ? weight : 0); metadata.weekendEvidence = (Number(metadata.weekendEvidence) || 0) + (day === 0 || day === 6 ? weight : 0);
  if (weight >= 0.5) { metadata.sessionCount = (Number(metadata.sessionCount) || 0) + 1; const seconds = observation.durationSeconds; metadata.shortSessions = (Number(metadata.shortSessions) || 0) + (seconds < 1800 ? 1 : 0); metadata.longSessions = (Number(metadata.longSessions) || 0) + (seconds >= 1800 ? 1 : 0); }
  const sessions = Array.isArray(metadata.evidenceSessions) ? metadata.evidenceSessions.filter(item => typeof item === 'string') as string[] : []; const sessionKey = context.sessionId ?? `${date}:${context.topic ?? context.category}`; if (!sessions.includes(sessionKey)) sessions.push(sessionKey); metadata.evidenceSessions = sessions.slice(-180); metadata.sourceTypes = [...new Set([...(Array.isArray(metadata.sourceTypes) ? metadata.sourceTypes.filter(item => typeof item === 'string') as string[] : []), ...(context.sourceTypes ?? ['desktop'])])].slice(0, 3);
  const projects = Array.isArray(metadata.projects) ? metadata.projects.filter(item => typeof item === 'string') as string[] : []; if (context.project && !projects.includes(context.project)) projects.push(context.project); metadata.projects = projects.slice(-30);
  const technologies = Array.isArray(metadata.technologies) ? metadata.technologies.filter(item => typeof item === 'string') as string[] : []; for (const technology of context.technologies) if (!technologies.includes(technology)) technologies.push(technology); metadata.technologies = technologies.slice(-30);
  metadata.topic = context.topic; metadata.subtopic = context.subtopic; metadata.project = context.project; metadata.sourceTypes = Array.isArray(metadata.sourceTypes) ? [...new Set([...metadata.sourceTypes.filter(item => typeof item === 'string'), ...(context.sourceTypes ?? ['desktop'])])].slice(0, 3) : (context.sourceTypes ?? ['desktop']); metadata.lastEvidence = source; return metadata;
}
