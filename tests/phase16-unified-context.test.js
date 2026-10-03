const test = require('node:test');
const assert = require('node:assert/strict');
const { ContextEngine } = require('../dist/context-engine');
const { canonicalTechnology, correlateActivities, freshnessWindow } = require('../dist/unified-context');
const at = '2026-09-30T12:00:00.000Z';
const activity = (id, source, application, title, durationSeconds = 60, startedAt = at) => ({ id, source, application, title, startedAt, endedAt: startedAt, durationSeconds });

test('unified context correlates desktop, browser, and folder sources', () => {
  const activities = [activity('d', 'foreground', 'Godot', '3D_horror - Main', 600), activity('b', 'browser', 'Browser: godotengine.org', 'Godot Engine', 120), activity('f', 'folder', 'Folder: 3D_horror', '.gd', 0)];
  const result = new ContextEngine().build(activities, Date.parse('2026-09-30T12:01:00Z'));
  assert.equal(result.topic, 'Godot');
  assert.equal(result.project, '3D_horror');
  assert.deepEqual(result.sourceTypes, ['desktop', 'browser', 'folder']);
  assert.ok(result.confidence > 0 && result.confidence <= 1);
  assert.ok(result.confidenceSignals.includes('source agreement'));
  assert.ok(result.evidence.some(item => item.includes('sources agree')));
});

test('same-source duplicates are suppressed while source attribution remains', () => {
  const activities = [activity('a', 'browser', 'Browser: example.com', 'TypeScript', 30), activity('a2', 'browser', 'Browser: example.com', 'TypeScript', 30), activity('d', 'foreground', 'VS Code', 'TypeScript', 60)];
  const result = new ContextEngine().build(activities, Date.parse('2026-09-30T12:01:00Z'));
  assert.ok(result.confidenceSignals.includes('duplicate observations suppressed'));
  assert.deepEqual(result.sourceTypes, ['desktop', 'browser']);
});

test('technology aliases are canonical and stale sources do not dominate', () => {
  assert.equal(canonicalTechnology('JS'), 'JavaScript');
  assert.equal(canonicalTechnology('TS'), 'TypeScript');
  const result = new ContextEngine().build([activity('old', 'browser', 'Browser: example.com', 'Godot', 600, '2026-09-30T10:00:00Z')], Date.parse('2026-09-30T12:00:00Z'));
  assert.equal(result, null);
  assert.equal(freshnessWindow('desktop'), 3600000);
});

test('correlation preserves bounded records and rejects unrelated stale inputs', () => {
  const result = correlateActivities([activity('d', 'foreground', 'VS Code', 'JavaScript', 30)], { category: 'Programming', topic: 'JavaScript', technologies: ['JS'] }, Date.parse('2026-09-30T12:01:00Z'));
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].technologies[0], 'JavaScript');
  assert.ok(result.sessionId.startsWith('session:'));
  assert.ok(result.sessionEnd >= result.sessionStart);
});
