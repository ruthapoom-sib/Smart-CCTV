const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../scripts/rain-client.js');

test('rain-client: older responses never replace new status and stop cancels polling', async () => {
  const pending = [];
  const updates = [];
  const client = create({
    baseUrl: 'http://api.local',
    fetchImpl: () => new Promise(resolve => pending.push(resolve)),
    pollMs: 100000,
  });

  client.start(value => updates.push(value));
  client.refresh();

  // Resolve 2nd request before 1st request
  pending[1]({ ok: true, json: async () => ({ cameras: [{ id: 'new', reading: { status: 'rainy' } }] }) });
  await new Promise(resolve => setImmediate(resolve));

  pending[0]({ ok: true, json: async () => ({ cameras: [{ id: 'old', reading: { status: 'dry' } }] }) });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(updates.length, 1);
  assert.equal(updates[0].cameras[0].id, 'new');
  client.stop();
  assert.equal(client.running, false);
});

test('rain-client: API failure invalidates status and authorization is only in headers', async () => {
  let captured;
  const client = create({
    baseUrl: 'https://api.local',
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { ok: false, status: 503 };
    },
  });

  await assert.rejects(client.request('/api/rain/cameras', { token: 'secret' }), /API 503/);
  assert.equal(captured.options.headers.Authorization, 'Bearer secret');
  assert.equal(captured.url.includes('secret'), false);
});
