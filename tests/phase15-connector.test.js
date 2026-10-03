const test = require('node:test');
const assert = require('node:assert/strict');
const { BrowserConnectorServer } = require('../dist/main/browser-connector');

test('connector requires pairing, authenticates submissions, and supports revocation', async () => {
  let hash = '';
  let accepted = 0;
  const server = new BrowserConnectorServer({ port: 47632, loadTokenHash: () => hash, saveTokenHash: value => { hash = value; }, clearTokenHash: () => { hash = ''; }, acceptPayload: payload => { accepted += 1; return { accepted: Boolean(payload && payload.domain) }; } });
  await server.start();
  try {
    const pair = await fetch('http://127.0.0.1:47632/pair-request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extensionId: 'test-extension' }) }).then(r => r.json());
    assert.equal(server.pendingRequests.length, 1);
    assert.equal((await fetch('http://127.0.0.1:47632/submit', { method: 'POST', body: '{}' })).status, 401);
    assert.equal(server.approve(pair.requestId), true);
    const paired = await fetch(`http://127.0.0.1:47632/pair-status?requestId=${pair.requestId}`).then(r => r.json());
    assert.equal(paired.status, 'paired');
    const acceptedResponse = await fetch('http://127.0.0.1:47632/submit', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${paired.token}` }, body: JSON.stringify({ domain: 'example.com' }) });
    assert.equal(acceptedResponse.status, 202);
    assert.equal(accepted, 1);
    const duplicate = await fetch('http://127.0.0.1:47632/submit', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${paired.token}` }, body: JSON.stringify({ domain: 'example.com' }) }).then(r => r.json());
    assert.equal(duplicate.duplicate, true);
    assert.equal(accepted, 1);
    server.revoke();
    assert.equal((await fetch('http://127.0.0.1:47632/submit', { method: 'POST', headers: { authorization: `Bearer ${paired.token}` }, body: '{}' })).status, 401);
  } finally { server.stop(); }
});

test('connector rate-limits accepted requests deterministically', async () => {
  let hash = '';
  const server = new BrowserConnectorServer({ port: 47633, loadTokenHash: () => hash, saveTokenHash: value => { hash = value; }, clearTokenHash: () => { hash = ''; }, acceptPayload: () => ({ accepted: true }) });
  await server.start();
  try {
    const pair = await fetch('http://127.0.0.1:47633/pair-request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extensionId: 'rate-test' }) }).then(r => r.json());
    server.approve(pair.requestId); const paired = await fetch(`http://127.0.0.1:47633/pair-status?requestId=${pair.requestId}`).then(r => r.json());
    let last; for (let i = 0; i < 61; i += 1) last = await fetch('http://127.0.0.1:47633/submit', { method: 'POST', headers: { authorization: `Bearer ${paired.token}` }, body: '{}' });
    assert.equal(last.status, 429);
  } finally { server.stop(); }
});
