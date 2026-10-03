export interface EmbeddingProvider {
  readonly providerName: string;
  readonly model: string;
  readonly dimensions: number;
  isAvailable(): boolean;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

/** Offline, deterministic local representation. It is a semantic-compatible fallback, not a trained semantic model. */
export class DeterministicLocalEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = 'local-deterministic';
  readonly model = 'hashed-token-character-v1';
  readonly dimensions = 96;
  isAvailable() { return true; }
  async embed(text: string) { return vectorize(text, this.dimensions); }
  async embedBatch(texts: string[]) { return Promise.all(texts.map(text => this.embed(text))); }
}

export interface LocalNeuralModelDescriptor { modelId: string; modelName: string; format: 'private-context-neural-manifest-v1'; dimensions: number; provider?: string; version?: string; runtime?: 'unavailable' | 'local-adapter-v1'; }
export interface LocalNeuralRuntime { isAvailable(): boolean; dimensions: number; embed(text: string): Promise<number[]>; embedBatch(texts: string[]): Promise<number[][]>; }

/**
 * Adapter for an explicitly installed local neural runtime. The production app
 * currently supplies no runtime, so an installed manifest is reported as
 * unavailable rather than pretending to execute a neural model.
 */
export class LocalNeuralEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = 'local-neural';
  readonly model: string;
  readonly dimensions: number;
  private descriptor: LocalNeuralModelDescriptor | null;
  private runtime?: LocalNeuralRuntime;
  constructor(descriptor: LocalNeuralModelDescriptor | null, runtime?: LocalNeuralRuntime) { this.descriptor = validDescriptor(descriptor) ? descriptor : null; this.runtime = runtime; this.model = this.descriptor?.modelName ?? 'model-not-installed'; this.dimensions = this.descriptor?.dimensions ?? 0; }
  isAvailable() { return Boolean(this.descriptor && this.runtime?.isAvailable() && this.runtime.dimensions === this.dimensions); }
  async embed(text: string) { if (!this.isAvailable() || !text.trim()) return []; const vector = await this.runtime!.embed(text); return validVector(vector, this.dimensions) ? vector : []; }
  async embedBatch(texts: string[]) { if (!this.isAvailable()) return []; const vectors = await this.runtime!.embedBatch(texts); return vectors.map(vector => validVector(vector, this.dimensions) ? vector : []); }
  async selfTest() { if (!this.isAvailable()) return { ok: false, reason: 'runtime unavailable' }; const first=await this.embed('private context local runtime self test'); const second=await this.embed('private context local runtime self test'); const ok=validVector(first,this.dimensions)&&validVector(second,this.dimensions)&&first.every((value,index)=>Math.abs(value-second[index])<1e-9); return {ok,reason:ok?'verified':'invalid or non-reproducible output'}; }
}

export class UnavailableEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = 'unavailable'; readonly model = 'none'; readonly dimensions: number;
  constructor(dimensions = 96) { this.dimensions = dimensions; }
  isAvailable() { return false; }
  async embed(_text: string) { return []; }
  async embedBatch(_texts: string[]) { return []; }
}

export function validLocalNeuralDescriptor(value: unknown): value is LocalNeuralModelDescriptor { return validDescriptor(value); }
function validDescriptor(value: unknown): value is LocalNeuralModelDescriptor { const item = value as Partial<LocalNeuralModelDescriptor> | null; return Boolean(item && item.format === 'private-context-neural-manifest-v1' && typeof item.modelId === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(item.modelId) && typeof item.modelName === 'string' && /^[A-Za-z0-9._ -]{1,120}$/.test(item.modelName) && typeof item.dimensions === 'number' && Number.isInteger(item.dimensions) && item.dimensions > 0 && item.dimensions <= 4096 && (item.provider === undefined || item.provider === 'local-neural') && (item.version === undefined || /^[A-Za-z0-9._-]{1,40}$/.test(item.version)) && (item.runtime === undefined || item.runtime === 'unavailable' || item.runtime === 'local-adapter-v1')); }
function validVector(vector: unknown, dimensions: number): vector is number[] { return Array.isArray(vector) && vector.length === dimensions && vector.every(value => typeof value === 'number' && Number.isFinite(value)); }
function vectorize(text: string, dimensions: number): number[] { const vector = new Array<number>(dimensions).fill(0); const normalized = text.normalize('NFKC').toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').trim(); if (!normalized) return vector; const tokens = normalized.split(/\s+/).filter(Boolean); for (const token of tokens) addHash(vector, token, 1 / Math.sqrt(tokens.length)); for (const token of tokens) for (let i = 0; i < token.length - 2; i++) addHash(vector, token.slice(i, i + 3), 0.12 / Math.sqrt(tokens.length)); const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)); return norm ? vector.map(value => value / norm) : vector; }
function addHash(vector: number[], value: string, weight: number) { let hash = 2166136261; for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619); const index = (hash >>> 0) % vector.length; vector[index] += (hash & 1) ? weight : -weight; }
