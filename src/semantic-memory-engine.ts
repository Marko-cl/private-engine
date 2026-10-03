import { createHash } from 'node:crypto';
import { EmbeddingProvider } from './embedding-provider';
import { MemoryRecord } from './shared/contracts';
import { expandSafeQuery } from './semantic-query';

export interface MemoryEmbedding { id: string; memoryId: string; provider: string; model: string; dimensions: number; vector: number[]; textHash: string; createdAt: string; updatedAt: string; }
export interface SemanticMemoryStore { getEmbedding(memoryId: string): MemoryEmbedding | null; saveEmbedding(embedding: MemoryEmbedding): void; getEmbeddings(): MemoryEmbedding[]; deleteEmbedding(memoryId: string): void; clearEmbeddings(): void; }
export interface SimilarMemory { memory: MemoryRecord; similarity: number; }

export class SemanticMemoryEngine {
  constructor(private provider: EmbeddingProvider, private store?: SemanticMemoryStore) {}
  isAvailable() { return this.provider.isAvailable(); }
  status() { return { available: this.isAvailable(), provider: this.provider.providerName, model: this.provider.model, dimensions: this.provider.dimensions, indexedMemoryCount: this.store?.getEmbeddings().length ?? 0 }; }
  embeddingText(memory: MemoryRecord): string { const metadata = safeMetadata(memory.metadataJson); const fields = [
    `Category: ${safeText(memory.category)}`,
    `Type: ${safeText(memory.type)}`,
    `Topic: ${safeText(metadata.topic ?? (memory.type === 'topic' ? memory.name : ''))}`,
    `Subtopic: ${safeText(metadata.subtopic)}`,
    `Project: ${safeText(metadata.project ?? (memory.type === 'project' ? memory.name : ''))}`,
    `Technologies: ${safeList(metadata.technologies)}`,
    `Concept: ${safeText(memory.name)}`
  ]; return fields.filter(line => !line.endsWith(': ')).join('\n'); }
  async indexMemory(memory: MemoryRecord): Promise<MemoryEmbedding | null> {
    if (!this.isAvailable() || !this.store) return null;
    const text = this.embeddingText(memory); const textHash = createHash('sha256').update(text, 'utf8').digest('hex'); const existing = this.store.getEmbedding(memory.id);
    if (existing && existing.textHash === textHash && existing.provider === this.provider.providerName && existing.model === this.provider.model && existing.dimensions === this.provider.dimensions) return existing;
    const vector = await this.provider.embed(text); if (!validVector(vector, this.provider.dimensions)) return null;
    const now = new Date().toISOString(); const embedding: MemoryEmbedding = { id: `embedding:${memory.id}`, memoryId: memory.id, provider: this.provider.providerName, model: this.provider.model, dimensions: vector.length, vector, textHash, createdAt: existing?.createdAt ?? now, updatedAt: now }; this.store.saveEmbedding(embedding); return embedding;
  }
  async indexMemories(memories: MemoryRecord[], max = 3) { let count = 0; for (const memory of memories) { if (count >= max) break; const existing = this.store?.getEmbedding(memory.id); const textHash = createHash('sha256').update(this.embeddingText(memory), 'utf8').digest('hex'); if (existing && existing.textHash === textHash && existing.provider === this.provider.providerName && existing.model === this.provider.model && existing.dimensions === this.provider.dimensions) continue; const result = await this.indexMemory(memory); if (result) count++; } return count; }
  removeMemory(memoryId: string) { this.store?.deleteEmbedding(memoryId); }
  clear() { this.store?.clearEmbeddings(); }
  async searchSimilarMemories(query: string, memories: MemoryRecord[], limit = 10, threshold = 0): Promise<SimilarMemory[]> {
    if (!this.isAvailable() || !this.store || !query.trim()) return [];
    const safeLimit = Math.max(1, Math.min(20, Math.floor(limit))); const safeThreshold = Math.max(0, Math.min(1, threshold)); const expandedQuery = expandSafeQuery(query); const queryVector = await this.provider.embed(expandedQuery); if (!validVector(queryVector, this.provider.dimensions)) return [];
    const byId = new Map(memories.map(memory => [memory.id, memory])); const results: SimilarMemory[] = [];
    for (const embedding of this.store.getEmbeddings()) { const memory = byId.get(embedding.memoryId); if (!memory || embedding.provider !== this.provider.providerName || embedding.model !== this.provider.model || embedding.dimensions !== queryVector.length) continue; const similarity = cosineSimilarity(queryVector, embedding.vector); if (similarity >= safeThreshold) results.push({ memory, similarity }); }
    return results.sort((a,b) => (b.similarity * .75 + b.memory.strength * .15 + b.memory.confidence * .1) - (a.similarity * .75 + a.memory.strength * .15 + a.memory.confidence * .1) || b.similarity - a.similarity || b.memory.strength - a.memory.strength || b.memory.lastSeen.localeCompare(a.memory.lastSeen) || a.memory.id.localeCompare(b.memory.id)).slice(0, safeLimit);
  }
}

export function cosineSimilarity(left: number[], right: number[]): number { if (!validVector(left) || !validVector(right) || left.length !== right.length) return 0; const leftNorm = Math.sqrt(left.reduce((sum, value) => sum + value * value, 0)); const rightNorm = Math.sqrt(right.reduce((sum, value) => sum + value * value, 0)); if (!leftNorm || !rightNorm) return 0; return Math.max(-1, Math.min(1, left.reduce((sum, value, index) => sum + value * right[index], 0) / (leftNorm * rightNorm))); }
function validVector(vector: unknown, dimensions?: number): vector is number[] { return Array.isArray(vector) && (!dimensions || vector.length === dimensions) && vector.every(value => typeof value === 'number' && Number.isFinite(value)); }
function safeMetadata(value: string): Record<string, unknown> { try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
function safeText(value: unknown) { return typeof value === 'string' ? value.replace(/[\r\n]/g, ' ').slice(0, 200) : ''; }
function safeList(value: unknown) { return Array.isArray(value) ? value.filter(item => typeof item === 'string').map(item => safeText(item)).join(', ') : ''; }
