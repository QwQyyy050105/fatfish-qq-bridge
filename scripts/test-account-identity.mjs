import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountGuard, expectedBotQQ } from '../src/account-guard.js';
import { discoverSnowLumaConnection } from '../src/snowluma-conn.js';

const cfg = { snowluma: { expectedQQ: '100000002', httpUrl: 'http://127.0.0.1:3020', accessToken: 'fixture' } };
const response = (user_id) => ({ ok: true, json: async () => ({ status: 'ok', retcode: 0, data: { user_id } }) });

test('bot identity is independent from ownerQQ and rejects malformed binding', () => {
  assert.equal(expectedBotQQ({ ...cfg, ownerQQ: '100000001' }), '100000002');
  assert.throws(() => expectedBotQQ({ snowluma: { expectedQQ: 'bad' } }), /expectedQQ/);
  assert.equal(expectedBotQQ({}), '');
});

test('wrong HTTP account never receives the requested action, even after an earlier correct login', async () => {
  let actual = '100000002';
  const calls = [];
  const guard = createAccountGuard(() => cfg, async (url) => { calls.push(url); return response(actual); });
  await guard.fetch('http://127.0.0.1:3020/send_group_msg');
  actual = '100000001';
  await assert.rejects(guard.fetch('http://127.0.0.1:3020/send_group_msg'), /账号不匹配/);
  assert.equal(calls.filter((x) => x.endsWith('/send_group_msg')).length, 1);
  assert.equal(guard.acceptEvent({ self_id: '100000001' }), false);
  assert.equal(guard.acceptEvent({}), false);
  assert.equal(guard.acceptEvent({ self_id: 100000002 }), true);
});

test('WebSocket actions recheck the actual account and fail before sending or reading messages', async () => {
  let actual = '100000001';
  const actions = [];
  const bot = createAccountGuard(() => cfg).wrapClient({ request: async (action) => {
    actions.push(action); return { status: 'ok', retcode: 0, data: { user_id: actual } };
  } });
  await assert.rejects(bot.request('send_private_msg', {}), /账号不匹配/);
  await assert.rejects(bot.request('get_group_msg_history', {}), /账号不匹配/);
  assert.deepEqual(actions, ['get_login_info', 'get_login_info']);
  actual = '100000002';
  await bot.request('send_private_msg', {});
  assert.equal(actions.at(-1), 'send_private_msg');
});

test('discovery refuses an accessible owner account instead of following it', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => response('100000001');
  try {
    const result = await discoverSnowLumaConnection({ cfg, homeDirs: [], timeoutMs: 100 });
    assert.equal(result.ok, false);
    assert.match(result.error, /100000002/);
    assert.equal(result.tried[0].actualQQ, '100000001');
  } finally { globalThis.fetch = original; }
});
