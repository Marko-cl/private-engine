const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

function plan(id, createdAt, steps) {
  return {
    id,
    title: id,
    description: `${id} description`,
    sourceContext: 'test',
    status: 'pending',
    createdAt,
    expiresAt: '2099-01-01T00:00:00.000Z',
    steps
  };
}

function step(planId, order) {
  return {
    id: `${planId}-step-${order}`,
    order,
    title: `Step ${order}`,
    description: `Step ${order} description`,
    tool: 'get_current_context',
    arguments: {},
    permissionLevel: 1,
    requiresConfirmation: false,
    status: 'pending',
    createdAt: `2026-01-01T00:00:${String(order).padStart(2, '0')}.000Z`,
    idempotencyKey: `${planId}-key-${order}`,
    dependsOn: [],
    attemptCount: 0,
    maxAttempts: 1,
    retryable: false
  };
}

test('ActivityDatabase.plans batches steps while preserving per-plan ordering', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-plans-'));
  const electronMock = { app: { getPath: () => userData } };
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'electron') return electronMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  let database;
  try {
    const { ActivityDatabase } = require('../dist/main/database');
    database = new ActivityDatabase();
    const insertPlan = database.db.prepare('INSERT INTO agent_plans(id,title,description,source_context,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?)');
    const insertStep = database.db.prepare('INSERT INTO agent_plan_steps(id,plan_id,step_order,title,description,tool,arguments,permission_level,requires_confirmation,status,created_at,idempotency_key,dependencies,attempt_count,max_attempts,retryable) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const insert = database.db.transaction((value) => {
      insertPlan.run(value.id, value.title, value.description, value.sourceContext, value.status, value.createdAt, value.expiresAt);
      for (const item of value.steps) insertStep.run(item.id, value.id, item.order, item.title, item.description, item.tool, JSON.stringify(item.arguments), item.permissionLevel, item.requiresConfirmation ? 1 : 0, item.status, item.createdAt, item.idempotencyKey, JSON.stringify(item.dependsOn ?? []), item.attemptCount ?? 0, item.maxAttempts ?? 1, item.retryable ? 1 : 0);
    });
    insert(plan('zero', '2026-01-03T00:00:00.000Z', []));
    insert(plan('maximum', '2026-01-02T00:00:00.000Z', Array.from({ length: 10 }, (_, index) => step('maximum', index))));
    insert(plan('multiple', '2026-01-01T00:00:00.000Z', [step('multiple', 2), step('multiple', 0), step('multiple', 1)]));

    const result = database.plans();
    assert.deepEqual(result.map(item => item.id), ['zero', 'maximum', 'multiple']);
    assert.deepEqual(result.find(item => item.id === 'zero').steps, []);
    assert.deepEqual(result.find(item => item.id === 'maximum').steps.map(item => item.order), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual(result.find(item => item.id === 'multiple').steps.map(item => item.order), [0, 1, 2]);
  } finally {
    if (database) database.db.close();
    Module._load = originalLoad;
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
