const test = require('node:test');
const assert = require('node:assert/strict');
const { explainMemory, explainPreference, explainRecommendation } = require('../dist/explainability');
const emptyFeedback = { totalUseful: 0, totalNotUseful: 0, totalDismissed: 0, totalIgnored: 0, byType: {}, byCategory: {}, byTopic: {}, byProject: {}, byTool: {} };

test('memory explanation is aggregate, bounded, and source attributed', () => {
  const result = explainMemory({ id: 'memory:godot', type: 'topic', name: 'Godot', category: 'Game Development', strength: .8, confidence: .7, firstSeen: '2026-01-01T00:00:00Z', lastSeen: '2026-10-01T00:00:00Z', evidenceCount: 12, totalSeconds: 3000, source: 'context', metadataJson: JSON.stringify({ observedDays: ['2026-09-01', '2026-09-02'], projects: ['Demo'], technologies: ['GDScript'], sourceTypes: ['desktop', 'folder'], rawPath: '/private/project', rawUrl: 'https://x.test/?token=secret' }) }, Date.parse('2026-10-02T00:00:00Z'));
  assert.equal(result.evidenceCount, 12);
  assert.deepEqual(result.sources, ['Desktop', 'Folder']);
  assert.deepEqual(result.projects, ['Demo']);
  assert.equal(JSON.stringify(result).includes('/private/project'), false);
  assert.equal(JSON.stringify(result).includes('token=secret'), false);
  assert.ok(result.lineage.length > 0);
});

test('preference explanation exposes evidence and feedback without raw records', () => {
  const result = explainPreference({ id: 'preference:godot', name: 'Godot', category: 'Game Development', strength: .78, confidence: .86, firstSeen: '2026-01-01', lastSeen: '2026-10-01', evidenceCount: 18, totalSeconds: 10000, updatedAt: '2026-10-01', distinctDays: 8, trend: 'rising', evidenceSummary: 'Repeated observations across multiple days', feedbackEvidence: 2, projects: ['Demo'], technologies: ['GDScript'] });
  assert.equal(result.feedbackInfluence, 2);
  assert.deepEqual(result.projects, ['Demo']);
  assert.deepEqual(result.technologies, ['GDScript']);
  assert.equal(result.lineage[0].sourceType, 'Preference');
});

test('recommendation explanation uses stored signals and does not invent evidence', () => {
  const result = explainRecommendation({ id: 'recommendation:continue', type: 'continue_project', title: 'Continue Godot', description: 'Local', category: 'Game Development', reason: 'Strong current-context match.', confidence: .8, score: 82, createdAt: '2026-10-01', sourceContext: 'Game Development / Godot', signals: ['Current context', 'Preference', 'Feedback'] }, emptyFeedback);
  assert.deepEqual(result.signals, ['Current context', 'Preference', 'Feedback']);
  assert.equal(result.recommendation.score, 82);
  assert.equal(result.sourceTypes.includes('Desktop'), true);
  assert.equal(result.signals.includes('Semantic support'), false);
});
