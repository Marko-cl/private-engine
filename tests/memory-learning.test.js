const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryEngine } = require('../dist/memory-engine');
const { PreferenceEngine } = require('../dist/preference-engine');
const { PrivacyManager } = require('../dist/main/privacy-manager');

const now = Date.parse('2026-09-30T12:00:00.000Z');
const context = { category: 'Game Development', topic: 'Godot', subtopic: 'Enemy AI', project: '3D_horror', technologies: ['Godot','GDScript'], confidence: .9, evidence: [], recentTopics: ['Godot','Enemy AI'] };
const observation = (ctx=context, minutes=10, at=now) => ({ context: ctx, observedAt: new Date(at).toISOString(), durationSeconds: minutes * 60 });

test('first observation creates weak memory', () => { const m = new MemoryEngine().update([], observation()); const godot = m.find(x=>x.name==='Godot'); assert.ok(godot); assert.ok(godot.strength < .5); assert.ok(godot.confidence < .5); });
test('repeated observation strengthens memory', () => { const e = new MemoryEngine(); let m=e.update([],observation()); m=e.update(m,observation(context,10,now+86400000)); const godot=m.find(x=>x.name==='Godot'); assert.ok(godot.strength > .3); assert.ok(godot.evidenceCount >= 2); });
test('long activity increases evidence and total time', () => { const m=new MemoryEngine().update([],observation(context,60)); const godot=m.find(x=>x.name==='Godot'); assert.equal(godot.totalSeconds,3600); assert.equal(godot.evidenceCount,1); });
test('related topics reinforce related memories', () => { const m=new MemoryEngine().update([],observation()); assert.ok(m.some(x=>x.name==='Game Engine')); assert.ok(m.some(x=>x.name==='Navigation')); });
test('old activity decays without immediate deletion', () => { const e=new MemoryEngine({halfLifeDays:90}); const m=e.update([],observation()); const decayed=e.decay(m.find(x=>x.name==='Godot'),now+180*86400000); assert.ok(decayed.strength < m.find(x=>x.name==='Godot').strength); });
test('one-time activity does not create a strong preference', () => { const memories=new MemoryEngine().update([],observation()); assert.equal(new PreferenceEngine().update([],memories,new Date(now).toISOString()).length,0); });
test('repeated activity creates a stronger preference', () => { const e=new MemoryEngine(); let m=e.update([],observation()); m=e.update(m,observation(context,20,now+86400000)); const p=new PreferenceEngine().update([],m,new Date(now+86400000).toISOString()); assert.ok(p.find(x=>x.name==='Godot').strength > .3); });
test('memory retrieval works', () => { const e=new MemoryEngine(); const m=e.update([],observation()); assert.equal(e.getMemory(m,'Godot').name,'Godot'); assert.ok(e.getRelevantMemories(m,'Game').length); assert.ok(e.getProjectMemories(m,'3D_horror').length); assert.ok(e.getRecentMemories(m,new Date(now-1000).toISOString()).length); });
test('preference retrieval works', () => { const e=new MemoryEngine(); let m=e.update([],observation()); m=e.update(m,observation(context,10,now+86400000)); const p=new PreferenceEngine().update([],m,new Date(now+86400000).toISOString()); assert.equal(new PreferenceEngine().getTopPreferences(p,1).length,1); assert.equal(new PreferenceEngine().getPreference(p,'Godot').name,'Godot'); });
test('delete memory works in the pure engine', () => { const e=new MemoryEngine(); const m=e.update([],observation()); const id=m[0].id; assert.equal(e.deleteMemory(m,id).some(x=>x.id===id),false); });
test('memory retention keeps recent records and removes expired ones', () => { const e=new MemoryEngine(); const m=e.update([],observation()); assert.equal(e.retain(m,'30 days',now+31*86400000).length,0); assert.equal(e.retain(m,'Forever',now+1000).length,m.length); });
test('memory learning disabled leaves memories unchanged', () => { const e=new MemoryEngine(); const m=e.update([],observation()); const learningEnabled=false; const next=learningEnabled?e.update(m,observation(context,10,now+86400000)):m; assert.equal(next.find(x=>x.name==='Godot').evidenceCount,1); });
test('paused tracking prevents new memory evidence', () => { const privacy=new PrivacyManager({excludedApps:()=>[],audit:()=>{}}); privacy.pause(); assert.equal(privacy.isTrackingAllowed(),false); });
test('excluded applications provide no memory evidence', () => { const privacy=new PrivacyManager({excludedApps:()=>['Discord'],audit:()=>{}}); assert.equal(privacy.isTrackingAllowed('Discord'),false); });
