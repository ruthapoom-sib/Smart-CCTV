const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function loadCore() {
  const code = fs.readFileSync('scripts/rain-core.js', 'utf8');
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context.globalThis.CctvRainCore;
}

test('rain-core status labels in Thai', () => {
  const core = loadCore();
  assert.equal(core.label('rainy'), 'ฝนตก');
  assert.equal(core.label('dry'), 'ไม่พบฝน');
  assert.equal(core.label('unknown'), 'ประเมินฝนไม่ได้');
  assert.equal(core.label('unconfigured'), 'ยังไม่เปิดตรวจฝน');
  assert.equal(core.label('something_else'), 'ประเมินฝนไม่ได้');
});

test('rain-core effective freshness and gap', () => {
  const core = loadCore();
  const now = 1000000;
  const reading = {
    camera_id: '03',
    captured_at: now - 60,
    processed_at: now - 59,
    status: 'rainy',
    detector_score: 0.8,
  };

  // Fresh reading within 180s
  const fresh = core.effective(reading, now * 1000);
  assert.equal(fresh.status, 'rainy');
  assert.equal(fresh.detector_score, 0.8);

  // Stale reading > 180s
  const stale = core.effective(reading, (now + 200) * 1000);
  assert.equal(stale.status, 'unknown');
  assert.equal(stale.detector_score, null);

  // Unconfigured stays unconfigured
  const unconf = core.effective({ status: 'unconfigured' }, now * 1000);
  assert.equal(unconf.status, 'unconfigured');
});
