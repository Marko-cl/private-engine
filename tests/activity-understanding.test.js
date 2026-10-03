const test = require('node:test');
const assert = require('node:assert/strict');
const { TopicExtractor } = require('../dist/topic-extractor');
const { CategoryClassifier } = require('../dist/category-classifier');
const { ProjectDetector } = require('../dist/project-detector');
const { ContextEngine } = require('../dist/context-engine');
const { PrivacyManager } = require('../dist/main/privacy-manager');

const now = Date.parse('2026-09-30T12:00:00.000Z');
const activity = (application, title, minutes, offset = 0) => ({ id: `${application}-${title}`, application, title, startedAt: new Date(now - (offset + minutes) * 60000).toISOString(), endedAt: new Date(now - offset * 60000).toISOString(), durationSeconds: minutes * 60 });

test('detects Godot development signals', () => {
  const result = new TopicExtractor().extract([activity('VS Code', '3D_horror - granny.gd', 32)]);
  assert.equal(result[0].name, 'Godot');
  assert.equal(result[0].technology, 'GDScript');
});
test('classifies VS Code project work as programming/game development', () => {
  const result = new CategoryClassifier().classify([activity('VS Code', '3D_horror - granny.gd', 32)]);
  assert.equal(result.name, 'Game Development');
  assert.equal(result.parent, 'Programming');
});
test('detects gaming', () => assert.equal(new CategoryClassifier().classify([activity('Minecraft', 'Minecraft', 20)]).name, 'Gaming'));
test('detects music', () => assert.equal(new CategoryClassifier().classify([activity('Spotify', 'Music', 20)]).name, 'Music'));
test('detects Discord as social', () => assert.equal(new CategoryClassifier().classify([activity('Discord', 'Friends', 20)]).name, 'Social'));
test('unknown activity is Other', () => assert.equal(new CategoryClassifier().classify([activity('Calculator', 'Simple calculation', 2)]).name, 'Other'));
test('combines multiple recent activities into one context', () => {
  const context = new ContextEngine().build([activity('VS Code', '3D_horror - granny.gd', 32), activity('VS Code', '3D_horror - NavigationAgent3D.gd', 10, 32)], now);
  assert.equal(context.category, 'Game Development');
  assert.equal(context.topic, 'Godot');
  assert.ok(context.recentTopics.includes('Enemy AI'));
});
test('context confidence is bounded and strengthened by evidence', () => {
  const context = new ContextEngine().build([activity('VS Code', '3D_horror - granny.gd', 32), activity('VS Code', '3D_horror - NavigationAgent3D.gd', 10, 32)], now);
  assert.ok(context.confidence >= 0.2 && context.confidence <= 0.99);
});
test('detects a project from a structured window title', () => {
  const project = new ProjectDetector().detect([activity('VS Code', '3D_horror - granny.gd', 20)]);
  assert.equal(project.name, '3D_horror');
  assert.ok(project.confidence > 0.5);
});
test('excluded applications are rejected by privacy manager', () => {
  const privacy = new PrivacyManager({ excludedApps: () => ['Discord'], audit: () => {} });
  assert.equal(privacy.isTrackingAllowed('Discord'), false);
  assert.equal(privacy.isTrackingAllowed('VS Code'), true);
});
test('paused tracking rejects all applications', () => {
  const privacy = new PrivacyManager({ excludedApps: () => [], audit: () => {} });
  privacy.pause();
  assert.equal(privacy.isTrackingAllowed('VS Code'), false);
});
test('empty activity history has no context', () => assert.equal(new ContextEngine().build([], now), null));
