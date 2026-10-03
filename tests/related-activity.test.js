const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRelatedActivityResult } = require('../dist/related-activity');
const { PreferenceEngine } = require('../dist/preference-engine');

const context = { category: 'Programming', topic: 'Godot', subtopic: 'Enemy AI', project: 'Horror Game', technologies: ['GDScript'], confidence: .8, evidence: [], recentTopics: ['Godot'] };
const memory = { id: 'memory:Godot', type: 'topic', name: 'Godot', category: 'Programming', strength: .7, confidence: .8, firstSeen: '2026-09-01T00:00:00Z', lastSeen: '2026-09-30T00:00:00Z', evidenceCount: 2, totalSeconds: 3600, source: 'context', metadataJson: JSON.stringify({ observedDays: ['2026-09-29', '2026-09-30'], topic: 'Godot', technologies: ['GDScript'], projects: ['Horror Game'] }) };

test('related activity is empty at cold start and local after repeated evidence', () => {
  const cold = buildRelatedActivityResult(context, [], [], [], [], 8);
  assert.deepEqual(cold, { contextLabel: 'Godot · Horror Game · GDScript', items: [], emptyReason: 'Nothing related found yet for this activity.' });
  const preferences = new PreferenceEngine().update([], [memory], '2026-09-30T00:00:00Z');
  const related = buildRelatedActivityResult(context, [memory], preferences, [], [], 8);
  assert.ok(related.items.some(item => item.kind === 'memory' && item.label === 'Godot'));
  assert.ok(related.items.some(item => item.kind === 'preference' && item.label === 'Godot'));
  assert.ok(related.items.some(item => item.kind === 'project' && item.label === 'Horror Game'));
  assert.ok(related.items.every(item => item.label.length <= 160 && item.reason.length <= 240));
  assert.equal(related.items.length <= 8, true);
  assert.equal(JSON.stringify(related).includes('https://'), false);
});
