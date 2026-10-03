const test = require('node:test');
const assert = require('node:assert/strict');
const { RecommendationEngine } = require('../dist/recommendation-engine');

const now = Date.parse('2026-09-30T12:00:00.000Z');
const context = { category:'Game Development', topic:'Godot', subtopic:'Enemy AI', project:'3D_horror', technologies:['Godot','GDScript'], confidence:.9, evidence:[], recentTopics:['Godot','Enemy AI'] };
const recent = [{id:'a',application:'VS Code',title:'3D_horror - granny.gd',startedAt:new Date(now-30*60000).toISOString(),endedAt:new Date(now).toISOString(),durationSeconds:1800}];
const memory = (name,type='topic',strength=.8,evidenceCount=4,category='Game Development')=>({id:`memory:${name}`,type,name,category,strength,confidence:.8,firstSeen:new Date(now-86400000).toISOString(),lastSeen:new Date(now-3600000).toISOString(),evidenceCount,totalSeconds:3600,source:'test',metadataJson:'{}'});
const preference = (name,strength=.9)=>({id:`preference:${name}`,name,category:'Game Development',strength,confidence:.9,firstSeen:new Date(now-86400000).toISOString(),lastSeen:new Date(now-3600000).toISOString(),evidenceCount:4,totalSeconds:3600,updatedAt:new Date(now).toISOString()});
const engine=new RecommendationEngine();

test('strong preference creates a relevant recommendation',()=>{const r=engine.generate(context,[memory('Godot')],[preference('Godot')],recent,new Date(now).toISOString());assert.ok(r.length);assert.ok(r.some(x=>/Godot|3D_horror|Enemy AI/.test(x.title)));});
test('current context increases relevant recommendation score',()=>{const r=engine.generate(context,[memory('Godot')],[preference('Godot')],recent,new Date(now).toISOString());assert.ok(r[0].score>40);});
test('weak memory produces a lower score than strong memory',()=>{const strong=engine.generate(context,[memory('Godot','topic',.9,5)],[preference('Godot',.9)],recent,new Date(now).toISOString());const weak=engine.generate(context,[memory('Godot','topic',.1,1)],[],recent,new Date(now).toISOString());assert.ok(strong[0].score>weak[0].score);});
test('unrelated interests do not rank highly',()=>{const r=engine.generate(context,[memory('Minecraft','topic',.9,5,'Gaming')],[preference('Minecraft',.9)],recent,new Date(now).toISOString());assert.ok(!r.some(x=>x.title.includes('Minecraft')));});
test('empty context returns no recommendations',()=>assert.deepEqual(engine.generate(null,[],[],recent,new Date(now).toISOString()),[]));
test('missing memories and preferences are safe',()=>assert.ok(engine.generate(context,[],[],[],new Date(now).toISOString()).every(x=>x.score>=0)));
test('scores remain between 0 and 100',()=>{const r=engine.generate(context,[memory('Godot')],[preference('Godot')],recent,new Date(now).toISOString());assert.ok(r.every(x=>x.score>=0&&x.score<=100&&x.confidence>=0&&x.confidence<=1));});
test('duplicate recommendation titles are prevented',()=>{const r=engine.generate(context,[memory('Godot'),memory('Godot','technology')],[preference('Godot')],recent,new Date(now).toISOString());assert.equal(new Set(r.map(x=>x.title)).size,r.length);});
test('recommendation deletion works',()=>{const r=engine.generate(context,[memory('Godot')],[preference('Godot')],recent,new Date(now).toISOString());assert.equal(engine.deleteRecommendation(r,r[0].id).some(x=>x.id===r[0].id),false);});
test('recommendation clearing works',()=>{const r=engine.generate(context,[memory('Godot')],[preference('Godot')],recent,new Date(now).toISOString());assert.deepEqual(engine.clearRecommendations(r),[]);});
