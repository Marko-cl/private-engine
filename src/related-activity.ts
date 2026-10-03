import { buildConceptCluster } from './memory-clusters';
import { CurrentContext, MemoryRecord, PreferenceRecord, Recommendation } from './shared/contracts';
import { SimilarMemory } from './semantic-memory-engine';

export type RelatedActivityKind = 'memory' | 'preference' | 'project' | 'recommendation';
export interface RelatedActivityItem { kind: RelatedActivityKind; label: string; reason: string; }
export interface RelatedActivityResult { contextLabel: string; items: RelatedActivityItem[]; emptyReason: string; }

interface Candidate { item: RelatedActivityItem; score: number; tie: string; }

export function buildRelatedActivityResult(context: CurrentContext | null, memories: MemoryRecord[], preferences: PreferenceRecord[], recommendations: Recommendation[], semanticMatches: SimilarMemory[] = [], limit = 8): RelatedActivityResult {
  const safeLimit = Math.max(1, Math.min(8, Math.floor(limit)));
  if (!context) return { contextLabel: '', items: [], emptyReason: 'No current activity context is available yet.' };
  const roots = [context.topic, context.subtopic, context.project, ...context.technologies].filter((value): value is string => Boolean(value));
  const contextTerms = new Set([context.category, ...roots].map(value => value.toLowerCase()));
  const clusterTerms = new Set<string>();
  for (const root of roots.slice(0, 5)) for (const concept of buildConceptCluster(root, memories, 8, 2).concepts) clusterTerms.add(concept.toLowerCase());
  const semanticById = new Map(semanticMatches.map(match => [match.memory.id, match.similarity]));
  const candidates: Candidate[] = [];
  const metadata = (memory: MemoryRecord): Record<string, unknown> => { try { const value = JSON.parse(memory.metadataJson); return value && typeof value === 'object' ? value as Record<string, unknown> : {}; } catch { return {}; } };
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map(item => item.toLowerCase()) : [];
  const memoryFields = (memory: MemoryRecord) => { const data = metadata(memory); return [memory.name, memory.category, ...strings(data.projects), ...strings(data.technologies), typeof data.topic === 'string' ? data.topic : '', typeof data.project === 'string' ? data.project : ''].map(value => value.toLowerCase()); };
  const overlap = (fields: string[]) => fields.some(field => [...contextTerms, ...clusterTerms].some(term => field === term || field.includes(term) || term.includes(field)));
  for (const memory of memories) {
    const fields = memoryFields(memory); const semantic = semanticById.get(memory.id) ?? 0; const direct = overlap(fields); if (!direct && semantic < .15) continue;
    const days = Math.max(1, strings(metadata(memory).observedDays).length); const evidence = Math.max(1, Math.round(memory.evidenceCount)); const reason = semantic >= .15 && !direct ? `Related by local semantic similarity; seen ${evidence} time${evidence === 1 ? '' : 's'} across ${days} day${days === 1 ? '' : 's'}.` : `Also connected to this context; seen ${evidence} time${evidence === 1 ? '' : 's'} across ${days} day${days === 1 ? '' : 's'}.`; candidates.push({ item: { kind: 'memory', label: memory.name.slice(0, 120), reason }, score: (direct ? 3 : 0) + semantic * 2 + memory.strength * .5 + memory.confidence * .25, tie: `memory:${memory.id}` });
  }
  for (const preference of preferences) {
    const fields = [preference.name, preference.category, ...(preference.projects ?? []), ...(preference.technologies ?? [])].map(value => value.toLowerCase()); if (!overlap(fields)) continue;
    const days = Math.max(1, preference.distinctDays ?? 1); const evidence = Math.max(1, Math.round(preference.evidenceCount)); candidates.push({ item: { kind: 'preference', label: preference.name.slice(0, 120), reason: `Sustained interest across ${days} distinct day${days === 1 ? '' : 's'} and ${evidence} recorded observation${evidence === 1 ? '' : 's'}.` }, score: 3 + preference.strength * .5 + preference.confidence * .25, tie: `preference:${preference.id}` });
  }
  if (context.project && memories.some(memory => memoryFields(memory).includes(context.project!.toLowerCase()))) candidates.push({ item: { kind: 'project', label: context.project.slice(0, 120), reason: 'Current project is present in your stored local activity.' }, score: 3.5, tie: `project:${context.project.toLowerCase()}` });
  for (const recommendation of recommendations) {
    const fields = [recommendation.title, recommendation.category, recommendation.topic ?? '', recommendation.project ?? '', recommendation.sourceContext].map(value => value.toLowerCase()); if (!overlap(fields)) continue;
    candidates.push({ item: { kind: 'recommendation', label: recommendation.title.slice(0, 160), reason: 'A previous local recommendation is tied to this topic or project.' }, score: 2.5 + recommendation.score / 100, tie: `recommendation:${recommendation.id}` });
  }
  const items = candidates.sort((a, b) => b.score - a.score || a.tie.localeCompare(b.tie)).filter((candidate, index, all) => all.findIndex(other => other.item.kind === candidate.item.kind && other.item.label.toLowerCase() === candidate.item.label.toLowerCase()) === index).slice(0, safeLimit).map(candidate => candidate.item);
  return { contextLabel: [context.topic, context.project, ...context.technologies].filter(Boolean).slice(0, 4).join(' · '), items, emptyReason: items.length ? '' : 'Nothing related found yet for this activity.' };
}
