const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryEngine } = require('../dist/memory-engine');
const { buildConceptCluster } = require('../dist/memory-clusters');
const { LocalNeuralEmbeddingProvider } = require('../dist/embedding-provider');
const { PreferenceEngine } = require('../dist/preference-engine');
const emptyFeedback = { totalUseful: 0, totalNotUseful: 0, totalDismissed: 0, totalIgnored: 0, byType: {}, byCategory: {}, byTopic: {}, byProject: {}, byTool: {} };
const context = (sessionId, sourceTypes = ['desktop']) => ({ category: 'Programming', parentCategory: 'Work', topic: 'JavaScript', subtopic: null, project: 'Demo', technologies: ['JS'], confidence: .8, evidence: [], recentTopics: ['JavaScript'], sessionId, sourceTypes });
const memory = (id, name, metadata = {}) => ({ id, type: 'topic', name, category: 'Programming', strength: .7, confidence: .8, firstSeen: '2026-01-01T00:00:00Z', lastSeen: '2026-10-01T00:00:00Z', evidenceCount: 3, totalSeconds: 100, source: 'context', metadataJson: JSON.stringify(metadata) });

test('memory canonicalization and session grouping prevent duplicate evidence inflation', () => {
  const engine = new MemoryEngine();
  const first = engine.update([], { context: { ...context('session:a'), topic: 'JS' }, observedAt: '2026-10-01T10:00:00Z', durationSeconds: 600, sessionId: 'session:a' });
  const second = engine.update(first, { context: context('session:a'), observedAt: '2026-10-01T10:05:00Z', durationSeconds: 600, sessionId: 'session:a' });
  const js = second.find(item => item.name === 'JavaScript');
  assert.ok(js);
  assert.ok(js.evidenceCount < 2);
  assert.ok(js.metadataJson.includes('evidenceSessions'));
});

test('memory strength and confidence remain bounded and grow across distinct sessions', () => {
  const engine = new MemoryEngine();
  let memories = engine.update([], { context: context('session:a'), observedAt: '2026-09-01T10:00:00Z', durationSeconds: 1800, sessionId: 'session:a' });
  const first = memories.find(item => item.name === 'JavaScript');
  memories = engine.update(memories, { context: context('session:b'), observedAt: '2026-10-01T10:00:00Z', durationSeconds: 1800, sessionId: 'session:b' });
  const second = memories.find(item => item.name === 'JavaScript');
  assert.ok(second.strength >= first.strength);
  assert.ok(second.strength <= 1 && second.confidence <= 1);
});

test('concept clusters use explicit relationships and hard limits', () => {
  const result = buildConceptCluster('Godot', [memory('g', 'Godot'), memory('gd', 'GDScript'), memory('nav', 'Navigation')], 5, 2);
  assert.equal(result.root, 'Godot');
  assert.ok(result.concepts.length <= 5);
  assert.ok(result.relationships.length <= 30);
  assert.ok(result.relationships.some(item => item.to === 'GDScript'));
});

test('neural descriptor rejects unsupported runtime metadata', () => {
  const provider = new LocalNeuralEmbeddingProvider({ modelId: 'safe', modelName: 'Safe', format: 'private-context-neural-manifest-v1', dimensions: 3, runtime: 'remote-runtime' }, { isAvailable: () => true, dimensions: 3, embed: async () => [1, 0, 0], embedBatch: async () => [[1, 0, 0]] });
  assert.equal(provider.isAvailable(), false);
});

test('preference evolution includes source diversity and project continuity', () => {
  const engine = new PreferenceEngine();
  const preferences = engine.update([], [memory('m', 'JavaScript', { observedDays: ['2026-09-01', '2026-09-02'], sourceTypes: ['desktop', 'browser'], projects: ['Demo', 'Other'], dailyEvidence: { '2026-09-01': 2, '2026-09-02': 2 }, timeBuckets: { evening: 2 } })], '2026-10-01T00:00:00Z', emptyFeedback);
  const preference = preferences[0];
  assert.deepEqual(preference.sourceTypes, ['desktop', 'browser']);
  assert.equal(preference.projectContinuity > 0, true);
  assert.ok(preference.confidence >= 0 && preference.confidence <= 1);
});
