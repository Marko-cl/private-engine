const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProjectProfiles } = require('../dist/project-intelligence');
const { expandSafeQuery } = require('../dist/semantic-query');
const memory = (id, name, metadata) => ({ id, type: 'topic', name, category: 'Programming', strength: .8, confidence: .9, firstSeen: '2026-09-01T00:00:00Z', lastSeen: '2026-10-01T00:00:00Z', evidenceCount: 8, totalSeconds: 1200, source: 'context', metadataJson: JSON.stringify(metadata) });
test('project profiles are deterministic, bounded, and lifecycle-aware', () => { const profiles = buildProjectProfiles([memory('1', 'JavaScript', { projects: ['Demo'], technologies: ['JS'], sourceTypes: ['desktop'] })], Date.parse('2026-10-02T00:00:00Z'), 10); assert.equal(profiles.length, 1); assert.equal(profiles[0].name, 'Demo'); assert.equal(profiles[0].lifecycle, 'stable'); assert.ok(profiles[0].technologies.includes('JS')); });
test('semantic query expansion uses only explicit bounded relationships', () => { const expanded = expandSafeQuery('Godot'); assert.ok(expanded.split(' ').length <= 40); assert.match(expanded, /Godot/); });
test('project profile metadata does not expose raw paths or urls', () => { const [profile] = buildProjectProfiles([memory('1', 'Topic', { projects: ['Demo'], path: '/private/file', url: 'https://secret.example' })]); assert.equal(JSON.stringify(profile).includes('/private/file'), false); assert.equal(JSON.stringify(profile).includes('secret.example'), false); });
