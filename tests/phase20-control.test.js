const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePlanProposal, nextStep } = require('../dist/plan-engine');
const { AGENT_TOOLS } = require('../dist/agent-tools');
test('individual plan dependencies are bounded and ordered',()=>{const p=validatePlanProposal({title:'Ordered',steps:[{tool:'open_url',arguments:{url:'https://a.example'}},{tool:'open_url',arguments:{url:'https://b.example'},dependsOn:[1]}]},AGENT_TOOLS,'2026-10-03T00:00:00Z');assert.equal(p.steps[1].dependsOn.length,1);assert.equal(nextStep(p).id,p.steps[0].id);p.steps[0].status='completed';assert.equal(nextStep(p).id,p.steps[1].id);});
test('plan dependencies reject forward references and cycles',()=>{assert.throws(()=>validatePlanProposal({title:'Bad',steps:[{tool:'open_url',arguments:{url:'https://a.example'},dependsOn:[2]},{tool:'open_url',arguments:{url:'https://b.example'}}]},AGENT_TOOLS));});
test('plan validation keeps level two confirmation explicit',()=>{const p=validatePlanProposal({title:'Confirm',steps:[{tool:'open_url',arguments:{url:'https://docs.example'}}]},AGENT_TOOLS);assert.equal(p.steps[0].requiresConfirmation,true);assert.equal(p.steps[0].permissionLevel,2);});
