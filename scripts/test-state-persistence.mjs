// Offline corruption/restart regression. Real bridge code, isolated fixture files,
// fake QQ/DSH peers, and injected filesystem failures; no production state reads.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { bridgeHarness } from './audit-bridge-harness.mjs';
import { persistSnowLumaEndpoint } from '../src/snowluma-conn.js';

let failures = 0;
let passed = 0;
async function test(name, run) {
  try { await run(); passed++; console.log('PASS', name); }
  catch (error) { failures++; console.error('FAIL', name, error?.stack ?? error); }
}
const unavailable = (error) => error?.statusCode === 503;
const stateFile = (h, name) => path.join(h.temp, 'state', name);
const unchanged = (h, name, original) => assert.equal(fs.readFileSync(stateFile(h, name), 'utf8'), original);
async function withHarness(options, run) {
  const h = await bridgeHarness(options);
  try { await run(h); } finally { await h.close(); }
}
function request(port, pathname, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname,
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', 'x-console-token': 'fixture-console-token' },
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(text) }); } catch (error) { reject(error); } });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('fixture HTTP timeout')));
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
async function withServer(h, run) {
  const server = h.startConsoleServer();
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  try { await run(server.address().port); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

await test('missing files and legacy sessions remain a supported first installation', async () => {
  for (const options of [{}, { savedState: { sessions: {} } }]) {
    await withHarness(options, async (h) => {
      assert.equal(Object.keys(h.stateStorageFaults()).length, 0);
      assert.equal(h.readRoleState().mode, 'active');
      assert.equal(h.socialV2.paused, false);
      const id = await h.ensureSession('private:123');
      assert.equal(id, 'fixture-1');
      h.saveState();
      assert.equal(JSON.parse(fs.readFileSync(stateFile(h, 'sessions.json'), 'utf8')).sessions['private:123'], id);
    });
  }
});

await test('existing empty, malformed and structurally invalid sessions are read-only and cannot create a replacement session', async () => {
  for (const original of ['', ' \r\n', '\0\0', '{', 'null', '[]', '{}', '{"sessions":[]}', '{"sessions":{"group:456":null}}', '{"sessions":{},"sessionPolicies":[]}']) {
    await withHarness({ files: { 'state/sessions.json': original } }, async (h) => {
      assert.equal(h.stateStorageFaults()['sessions.json'], 'invalid_state');
      h.saveState();
      unchanged(h, 'sessions.json', original);
      await assert.rejects(h.ensureSession('private:123'), unavailable);
      await assert.rejects(h.ensureSlangLearnerSession(), unavailable);
      assert.throws(() => h.sendToQQ('private:123', 'fixture'), unavailable);
      assert.equal(h.calls.created.length, 0);
      assert.equal(h.calls.sent.length, 0);
    });
  }
});

await test('damaged social state pauses activity and cannot be overwritten by automatic saves', async () => {
  for (const original of ['', '\0\0', '{', 'null', '[]', '{}', '{"conversations":[]}', '{"conversations":{},"paused":"false"}', '{"conversations":{"group:456":[]}}']) {
    await withHarness({ files: { 'state/social-v2.json': original } }, async (h) => {
      assert.equal(h.socialV2.paused, true);
      assert.equal(h.stateStorageFaults()['social-v2.json'], 'invalid_state');
      assert.equal(h.saveSocialV2State(), false);
      h.appendSocialV2Message('group:456', { text: 'fixture', userId: '999' });
      unchanged(h, 'social-v2.json', original);
      h.setMode('reserved2');
      await assert.rejects(h.sendWakePromptV2('group:456', 'proactiveCheck'), unavailable);
      await assert.rejects(h.deliverPrompt('group:456', 'fixture'), unavailable);
      assert.equal(h.calls.created.length, 0);
      assert.equal(h.calls.prompts.length, 0);
    });
  }
});

await test('invalid role state is silent, blocks owner traffic too, and refuses role changes that would erase evidence', async () => {
  for (const original of ['', '\0\0', '{', 'null', '[]', '{}', '{"role":null,"mode":"unknown"}', '{"role":{},"mode":"active"}']) {
    await withHarness({ files: { 'state/current-role.json': original } }, async (h) => {
      assert.equal(h.readRoleState().mode, 'silent');
      assert.equal(h.readRoleState().stateError, true);
      assert.throws(() => h.writeRoleState(null, 'active'), /拒绝覆盖/);
      assert.throws(() => h.sendToQQ('private:123', 'fixture'), unavailable);
      await assert.rejects(h.handleIncoming('private', 123, { user_id: 123, message: [] }, h.cfg), unavailable);
      await assert.rejects(h.sendVoiceV2('private:123', 'unused-fixture.wav'), unavailable);
      unchanged(h, 'current-role.json', original);
      assert.equal(h.calls.sent.length, 0);
      assert.equal(h.calls.http.length, 0);
    });
  }
});

await test('authenticated console exposes storage faults and rejects reset/unpause/send paths without overwriting damaged state', async () => {
  for (const name of ['sessions.json', 'social-v2.json', 'current-role.json']) {
    const original = '\0fixture-corruption';
    await withHarness({ files: { [`state/${name}`]: original } }, async (h) => {
      await withServer(h, async (port) => {
        const status = await request(port, '/api/status');
        assert.equal(status.status, 200);
        assert.equal(status.json.stateStorage.ready, false);
        assert.deepEqual(status.json.stateStorage.faults, { [name]: 'invalid_state' });
        for (const [route, body] of [
          ['/api/socialV2/activity', { paused: false }],
          ['/api/socialV2/reset', { key: 'group:456' }],
          ['/api/socialV2/wake', { key: 'group:456' }],
          ['/api/session/reset', { key: 'group:456' }],
          ['/api/workspace/reset', { confirm: true }],
          ['/api/role-mode', { mode: 'active' }],
          ['/api/test-send', { kind: 'private', id: 123, message: 'fixture' }],
          ['/api/send/voice', { key: 'private:123', path: 'unused-fixture.wav' }],
        ]) {
          assert.equal((await request(port, route, body)).status, 503, route);
          unchanged(h, name, original);
        }
      });
      assert.equal(h.calls.created.length + h.calls.prompts.length + h.calls.sent.length + h.calls.http.length, 0);
    });
  }
});

await test('read errors are not confused with absence and retain the original bytes', async () => {
  for (const name of ['sessions.json', 'social-v2.json', 'current-role.json']) {
    const original = name === 'sessions.json' ? '{"sessions":{}}' : name === 'social-v2.json' ? '{"conversations":{}}' : '{"role":null,"mode":"active"}';
    const testFs = { ...fs, readFileSync(file, ...args) {
      if (path.basename(String(file)) === name) throw Object.assign(new Error('fixture denied'), { code: 'EACCES' });
      return fs.readFileSync(file, ...args);
    } };
    await withHarness({ files: { [`state/${name}`]: original }, globals: { fs: testFs } }, async (h) => {
      assert.equal(h.stateStorageFaults()[name], 'EACCES');
      await assert.rejects(h.ensureSession('private:123'), unavailable);
      h.saveState(); h.saveSocialV2State();
      unchanged(h, name, original);
    });
  }
});

await test('role corruption during queued sends is rechecked at dispatch, and an explicit valid repair can recover', async () => {
  await withHarness({}, async (h) => {
    const pendingSend = h.sendToQQ('private:123', 'fixture');
    fs.writeFileSync(stateFile(h, 'current-role.json'), '{');
    await pendingSend; // sendChain records blocked sends and stays usable.
    assert.equal(h.calls.sent.length, 0);
    assert.equal(h.stateStorageFaults()['current-role.json'], 'invalid_state');
    fs.writeFileSync(stateFile(h, 'current-role.json'), '{"role":null,"mode":"active"}');
    await h.sendToQQ('private:123', 'fixture');
    assert.equal(h.calls.sent.length, 1);
    assert.equal(Object.keys(h.stateStorageFaults()).length, 0);
  });
});

await test('role corruption while DSH workspace creation is in flight blocks session creation', async () => {
  await withHarness({}, async (h) => {
    h.api.workspace.create = async () => {
      fs.writeFileSync(stateFile(h, 'current-role.json'), '{');
      return { result: { ok: true, value: { created: false, workspace: { workspaceId: 'fixture' } } } };
    };
    await assert.rejects(h.ensureSession('private:123'), /关键状态不可用/);
    assert.equal(h.calls.created.length, 0);
  });
});

await test('normal BOM role and paused social data preserve their semantics', async () => {
  await withHarness({ files: {
    'state/current-role.json': '\uFEFF{"role":null,"mode":"silent"}',
    'state/social-v2.json': '\uFEFF{"paused":true,"conversations":{}}',
    'state/sessions.json': '\uFEFF{"sessions":{}}',
  } }, async (h) => {
    assert.equal(Object.keys(h.stateStorageFaults()).length, 0);
    assert.equal(h.readRoleState().mode, 'silent');
    assert.equal(h.socialV2.paused, true);
  });
});

// Test the actual atomic state writer through writeRoleState; failures are injected
// only into the bridge's VM fs object and target only our fixture's role temp file.
await test('critical state flushes before replace; write/fsync/rename failures preserve original and clean only their temporary file', async () => {
  for (const failure of [null, 'write', 'fsync', 'rename', 'open']) {
    const events = [];
    const owned = new Set();
    const temporaryNames = [];
    const testFs = { ...fs,
      openSync(file, flags, mode) {
        if (String(file).includes('current-role.json.')) {
          events.push('open'); temporaryNames.push(String(file));
          assert.equal(flags, 'wx');
          if (failure === 'open') throw Object.assign(new Error('fixture collision'), { code: 'EEXIST' });
          const fd = fs.openSync(file, flags, mode); owned.add(fd); return fd;
        }
        return fs.openSync(file, flags, mode);
      },
      writeFileSync(file, data, ...args) {
        if (owned.has(file)) {
          events.push('write');
          if (failure === 'write') { fs.writeFileSync(file, 'partial'); throw Object.assign(new Error('fixture full'), { code: 'ENOSPC' }); }
        }
        return fs.writeFileSync(file, data, ...args);
      },
      fsyncSync(fd) {
        if (owned.has(fd)) { events.push('fsync'); if (failure === 'fsync') throw Object.assign(new Error('fixture sync'), { code: 'EIO' }); }
        return fs.fsyncSync(fd);
      },
      renameSync(from, to) {
        if (path.basename(String(to)) === 'current-role.json') {
          events.push('rename');
          if (failure === 'rename') throw Object.assign(new Error('fixture busy'), { code: 'EPERM' });
        }
        return fs.renameSync(from, to);
      },
      unlinkSync(file) {
        if (temporaryNames.includes(String(file))) { assert.notEqual(failure, 'open', 'must not unlink a file not created by us'); events.push('unlink'); }
        return fs.unlinkSync(file);
      },
    };
    const original = '{"role":null,"mode":"active"}';
    await withHarness({ files: { 'state/current-role.json': original }, globals: { fs: testFs } }, async (h) => {
      if (failure) {
        assert.throws(() => h.writeRoleState(null, 'silent'), /fixture/);
        unchanged(h, 'current-role.json', original);
      } else {
        h.writeRoleState(null, 'silent');
        assert.equal(h.readRoleState().mode, 'silent');
        assert.deepEqual(events, ['open', 'write', 'fsync', 'rename']);
      }
      assert.equal(fs.readdirSync(path.join(h.temp, 'state')).filter((name) => name.startsWith('current-role.json.') && name.endsWith('.tmp')).length, 0);
      if (failure === 'rename') assert.equal(events.filter((event) => event === 'rename').length, 4);
    });
  }
});

await test('SnowLuma config refuses invalid top-level/endpoint objects without changing any bytes', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-config-shape-'));
  try {
    const file = path.join(temp, 'config.json');
    for (const original of ['null', '[]', 'false', '"fixture"', '42', '{"snowluma":null}', '{"snowluma":[]}', '{"snowluma":"fixture"}']) {
      fs.writeFileSync(file, original);
      assert.throws(() => persistSnowLumaEndpoint(file, { httpUrl: 'http://127.0.0.1:9999' }), /invalid object structure/);
      assert.equal(fs.readFileSync(file, 'utf8'), original);
      assert.deepEqual(fs.readdirSync(temp), ['config.json']);
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

await test('SnowLuma atomic config preserves BOM and other fields, skips idempotent writes, and survives injected write/sync/replace errors', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-config-atomic-'));
  const originals = Object.fromEntries(['openSync', 'writeFileSync', 'fsyncSync', 'renameSync', 'unlinkSync'].map((name) => [name, fs[name]]));
  try {
    const file = path.join(temp, 'config.json');
    const original = '\uFEFF{"snowluma":{"httpUrl":"http://127.0.0.1:9998"},"fixtureKeep":{"value":17}}';
    for (const failure of [null, 'write', 'fsync', 'rename', 'open']) {
      originals.writeFileSync(file, original);
      const events = [];
      const owned = new Set();
      const temporaryNames = [];
      fs.openSync = (target, flags, mode) => {
        if (String(target).startsWith(`${file}.`)) {
          events.push('open'); temporaryNames.push(String(target)); assert.equal(flags, 'wx');
          if (failure === 'open') throw Object.assign(new Error('fixture collision'), { code: 'EEXIST' });
          const fd = originals.openSync(target, flags, mode); owned.add(fd); return fd;
        }
        return originals.openSync(target, flags, mode);
      };
      fs.writeFileSync = (target, data, ...args) => {
        if (owned.has(target)) { events.push('write'); if (failure === 'write') { originals.writeFileSync(target, 'partial'); throw Object.assign(new Error('fixture full'), { code: 'ENOSPC' }); } }
        return originals.writeFileSync(target, data, ...args);
      };
      fs.fsyncSync = (fd) => {
        if (owned.has(fd)) { events.push('fsync'); if (failure === 'fsync') throw Object.assign(new Error('fixture sync'), { code: 'EIO' }); }
        return originals.fsyncSync(fd);
      };
      fs.renameSync = (from, to) => {
        if (to === file) { events.push('rename'); if (failure === 'rename') throw Object.assign(new Error('fixture busy'), { code: 'EPERM' }); }
        return originals.renameSync(from, to);
      };
      fs.unlinkSync = (target) => {
        if (temporaryNames.includes(String(target))) { assert.notEqual(failure, 'open'); events.push('unlink'); }
        return originals.unlinkSync(target);
      };
      try {
        if (failure) {
          assert.throws(() => persistSnowLumaEndpoint(file, { httpUrl: 'http://127.0.0.1:9999' }), /fixture/);
          assert.equal(fs.readFileSync(file, 'utf8'), original);
        } else {
          assert.equal(persistSnowLumaEndpoint(file, { httpUrl: 'http://127.0.0.1:9999' }).updated, true);
          assert.deepEqual(events, ['open', 'write', 'fsync', 'rename']);
          const updated = fs.readFileSync(file, 'utf8');
          assert.equal(updated.charCodeAt(0), 0xFEFF);
          assert.equal(JSON.parse(updated.slice(1)).fixtureKeep.value, 17);
          assert.equal(JSON.parse(updated.slice(1)).snowluma.httpUrl, 'http://127.0.0.1:9999');
          events.length = 0;
          assert.equal(persistSnowLumaEndpoint(file, { httpUrl: 'http://127.0.0.1:9999' }).updated, false);
          assert.deepEqual(events, []);
          assert.equal(fs.readFileSync(file, 'utf8'), updated);
        }
        assert.deepEqual(fs.readdirSync(temp), ['config.json']);
        if (failure === 'rename') assert.equal(events.filter((event) => event === 'rename').length, 4);
      } finally { Object.assign(fs, originals); }
    }
  } finally { Object.assign(fs, originals); fs.rmSync(temp, { recursive: true, force: true }); }
});

console.log(`State persistence: ${passed} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
