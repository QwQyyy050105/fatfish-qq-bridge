import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { DEFAULT_CONFIG, validateConfig, configurationIssues, saveConfig, readConfig } from '../src/template/config.mjs';
import { CompatibleApiModel, FailureBackoff } from '../src/template/model.mjs';
import { ChatRuntime } from '../src/template/runtime.mjs';
import { MockTransport, runDemo } from '../src/template/demo.mjs';
import { loadPlugins } from '../src/template/plugins.mjs';
import { startPanel } from '../src/template/panel.mjs';
import { OneBotClient } from '../src/onebot-client.mjs';
const ROOT = path.resolve(import.meta.dirname, '..');
const fixture = changes => validateConfig({ transport: { enabled: true, expectedQQ: '100000002' }, allow: { groups: ['100000003', '100000005'] }, ...changes });
const event = (message = '小鲸鱼你好', changes = {}) => ({ self_id: '100000002', message_type: 'group', group_id: '100000003', user_id: '100000004', message_id: 1, sender: { nickname: 'Alice' }, message: [{ type: 'text', data: { text: message } }], ...changes });
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const closeHttp = server => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
test('defaults have no live targets, no participation or gateway activation', () => { const c = validateConfig(); assert.equal(c.transport.enabled, false); assert.deepEqual(c.allow.groups, []); assert.equal(c.participation.probability, 0); assert.ok(configurationIssues(c, {}).includes('model_not_configured')); });
test('strict validation rejects unknown fields, secret properties and untrusted URLs', () => {
  for (const value of [{ extra: true }, { model: { apiKey: 'do-not-store' } }, { panel: { host: '0.0.0.0' } }, { transport: { wsUrl: 'ws://public.example.com' } }, { model: { baseUrl: 'http://public.example.com' } }, { plugins: ['./extensions/../escape.mjs'] }, { allow: { groups: ['all'] } }]) assert.throws(() => validateConfig(value));
});
test('config roundtrip is atomic and portable', () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fatfish-config-')); try { saveConfig(root, { bot: { name: 'Demo' } }); assert.equal(readConfig(root).bot.name, 'Demo'); assert.equal(fs.readdirSync(root).length, 1); } finally { fs.rmSync(root, { recursive: true, force: true }); } });
test('mock end to end demo sends exactly once and blocks unauthorized scope', async () => { const result = await runDemo(); assert.equal(result.authorizedReplies, 1); assert.equal(result.network, false); assert.equal(result.outsideScopeBlocked, true); });
test('identity mismatch blocks all model calls and outgoing sends', async () => { let calls = 0; const transport = new MockTransport('999999999'); const runtime = new ChatRuntime(fixture(), { transport, model: { complete: async () => { calls++; return { text: 'oops' }; } } }); await assert.rejects(runtime.start()); assert.equal((await runtime.handle(event())).ignored, 'scope_or_identity'); assert.equal(calls, 0); assert.equal(transport.sent.length, 0); await runtime.close(); });
test('unauthorized/self messages never reach the model; duplicate events only send once', async () => { let calls = 0; const transport = new MockTransport(); const runtime = new ChatRuntime(fixture(), { transport, model: { complete: async () => { calls++; return { text: 'ok' }; } } }); await runtime.start(); await runtime.handle(event('x', { group_id: '999999999' })); await runtime.handle(event('x', { user_id: '100000002' })); await runtime.handle(event()); await runtime.handle(event()); assert.equal(calls, 1); assert.equal(transport.sent.length, 1); await runtime.close(); });
test('followup without name includes exact speaker and prior messages', async () => { const prompts = [], transport = new MockTransport(); const runtime = new ChatRuntime(fixture(), { transport, model: { complete: async messages => { prompts.push(messages); return { text: '北京吗' }; } } }); await runtime.start(); await runtime.handle(event()); await runtime.handle(event('今天天气怎么样', { message_id: 2 })); assert.equal(transport.sent.length, 2); assert.ok(prompts[1].at(-1).content.includes('Alice (id=100000004): 今天天气怎么样')); assert.ok(prompts[1].some(m => m.role === 'assistant')); await runtime.close(); });
test('separate groups do not share context unless explicitly opted in', async () => { for (const sharedAcrossScopes of [false, true]) { const prompts = [], transport = new MockTransport(); const runtime = new ChatRuntime(fixture({ context: { sharedAcrossScopes } }), { transport, model: { complete: async messages => { prompts.push(messages); return { text: 'ok' }; } } }); await runtime.start(); await runtime.handle(event('小鲸鱼A的秘密')); await runtime.handle(event('小鲸鱼第二个群', { group_id: '100000005', message_id: 2 })); assert.equal(prompts[1].some(m => m.content.includes('A的秘密')), sharedAcrossScopes); await runtime.close(); } });
test('model errors are locally visible and back off without spamming QQ', async () => { let calls = 0; const transport = new MockTransport(); const runtime = new ChatRuntime(fixture(), { transport, model: { complete: async () => { calls++; throw Object.assign(new Error('secret'), { code: 'model_connection_error' }); } } }); await runtime.start(); await runtime.handle(event()); await runtime.handle(event('小鲸鱼', { message_id: 2 })); assert.equal(calls, 1); assert.equal(transport.sent.length, 0); assert.equal(runtime.status().modelHealth.state, 'backoff'); assert.equal(runtime.status().lastError, 'model_connection_error'); await runtime.close(); });
test('exponential backoff resets after an actual model reply', () => { let time = 10; const b = new FailureBackoff({ now: () => time }); b.failure('model_timeout'); assert.equal(b.retryAt, 2010); time = 2011; assert.ok(b.ready()); b.failure('model_timeout'); assert.equal(b.retryAt, 6011); time = 6012; b.success(); assert.equal(b.failures, 0); assert.equal(b.snapshot().state, 'reply_verified'); });
test('configuration change cancels pending replies and prevents stale sends', async () => { let resolve; const transport = new MockTransport(); const runtime = new ChatRuntime(fixture(), { transport, model: { complete: () => new Promise(r => { resolve = r; }) } }); await runtime.start(); const job = runtime.handle(event()); await delay(0); runtime.reconfigure(fixture({ allow: { groups: [] } })); resolve({ text: 'stale' }); await job; assert.equal(transport.sent.length, 0); await runtime.close(); });
test('compatible API issues expected request without exporting credentials in errors', async () => { let captured; const model = new CompatibleApiModel({ ...DEFAULT_CONFIG.model, baseUrl: 'https://example.test/v1', model: 'chosen-model' }, { env: { BOT_API_KEY: 'fixture-not-a-real-key' }, fetchImpl: async (url, options) => { captured = { url, options }; return Response.json({ choices: [{ message: { content: 'OK' } }] }); } }); assert.equal((await model.complete([{ role: 'user', content: 'hello' }])).text, 'OK'); assert.equal(captured.url, 'https://example.test/v1/chat/completions'); assert.equal(JSON.parse(captured.options.body).model, 'chosen-model'); assert.equal(model.capabilities.tools, false); });
test('HTTP errors are normalized without provider body or API key', async () => { const model = new CompatibleApiModel(DEFAULT_CONFIG.model, { env: { BOT_API_KEY: 'fixture' }, fetchImpl: async () => new Response('provider secret', { status: 401 }) }); await assert.rejects(model.complete([]), error => error.code === 'model_http_401' && !error.message.includes('secret')); });
test('plugin is loaded from owner configuration and really serves a model turn', async () => { const registry = await loadPlugins(ROOT, ['./extensions/example-model.mjs']); const transport = new MockTransport(); const runtime = new ChatRuntime(fixture({ model: { adapter: 'example-echo' } }), { transport, registry }); await runtime.start(); await runtime.handle(event()); assert.ok(transport.sent[0].message.data.text.includes('离线示例收到')); await runtime.close(); await registry.dispose(); });
test('plugin manifest versions and directory boundaries are enforced', async () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fatfish-plugin-')); fs.mkdirSync(path.join(root, 'extensions')); fs.writeFileSync(path.join(root, 'extensions', 'bad.mjs'), 'export default {apiVersion:9,id:"bad",capabilities:[],setup(){}}'); try { await assert.rejects(loadPlugins(root, ['./extensions/bad.mjs']), /manifest/); fs.writeFileSync(path.join(root, 'outside.mjs'), 'export default {}'); await assert.rejects(loadPlugins(root, ['./outside.mjs']), /escaped/); } finally { fs.rmSync(root, { recursive: true, force: true }); } });
test('panel owner auth, CSRF, schema validation and personalization persistence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fatfish-panel-')); fs.mkdirSync(path.join(root, 'public')); fs.copyFileSync(path.join(ROOT, 'public/template.html'), path.join(root, 'public/template.html'));
  let applied; const config = validateConfig({ panel: { port: 0 } }); const token = 'fixture-owner-token';
  const panel = await startPanel({ root, config, token, status: () => ({ transport: 'disconnected', model: 'unverified' }), prepare: async next => ({ commit: () => { applied = next; } }), probe: async () => ({ actualModelReply: true }) });
  const headers = { Authorization: `Bearer ${token}`, 'x-csrf-token': token, Origin: panel.url, 'content-type': 'application/json' };
  try {
    assert.equal((await fetch(`${panel.url}/api/config`)).status, 401);
    assert.equal((await fetch(`${panel.url}/api/config`, { headers })).status, 200);
    const next = structuredClone(config); next.bot.name = 'New Name'; next.panel.accent = '#ffaa00';
    assert.equal((await fetch(`${panel.url}/api/config`, { method: 'PUT', headers: { ...headers, Origin: 'https://hostile.test' }, body: JSON.stringify(next) })).status, 403);
    assert.equal((await fetch(`${panel.url}/api/config`, { method: 'PUT', headers, body: JSON.stringify(next) })).status, 200);
    assert.equal(applied.bot.name, 'New Name'); assert.equal(readConfig(root).panel.accent, '#ffaa00');
    next.plugins = ['./extensions/unreviewed.mjs']; assert.equal((await fetch(`${panel.url}/api/config`, { method: 'PUT', headers, body: JSON.stringify(next) })).status, 400);
    const result = await (await fetch(`${panel.url}/api/model/probe`, { method: 'POST', headers, body: '{}' })).json(); assert.equal(result.actualModelReply, true);
    assert.ok((await (await fetch(panel.url)).text()).includes('人格与说话方式'));
  } finally { await panel.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
test('OneBot echo correlation, events, error code and timeout work against a real local WS peer', { timeout: 10000 }, async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await new Promise(resolve => server.once('listening', resolve));
  let peer; server.on('connection', socket => { peer = socket; socket.on('message', bytes => { const call = JSON.parse(bytes); if (call.action === 'timeout') return; socket.send(JSON.stringify({ echo: call.echo, status: call.action === 'bad' ? 'failed' : 'ok', retcode: call.action === 'bad' ? 1404 : 0, data: { user_id: '100000002' } })); }); });
  const client = new OneBotClient({ url: `ws://127.0.0.1:${server.address().port}`, reconnect: false, requestTimeoutMs: 2000 });
  try {
    await client.connect();
    assert.equal((await client.getLoginInfo()).user_id, '100000002');
    await assert.rejects(client.request('bad'), /retcode_1404/);
    // Only the deliberately unanswered action needs a short deadline. The WS
    // handshake and successful replies must tolerate normal CI scheduling.
    client.requestTimeoutMs = 50;
    await assert.rejects(client.request('timeout'), /request_timeout/);
    client.requestTimeoutMs = 2000;
    const got = new Promise(resolve => client.onGroupMessage(resolve));
    peer.send(JSON.stringify({ post_type: 'message', message_type: 'group', group_id: 123 }));
    assert.equal((await got).group_id, 123);
    const large = new Promise(resolve => client.onGroupMessage(resolve));
    peer.send('{"post_type":"message","message_type":"group","message_id":9007199254740993123}');
    assert.equal((await large).message_id, '9007199254740993123');
  }
  finally { client.close(); for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)); }
});
test('loopback HTTP model and OneBot transport complete a real protocol pipeline without QQ/cloud', async () => {
  const api = http.createServer((req, res) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { const body = JSON.parse(Buffer.concat(chunks)); assert.equal(body.model, 'fixture-model'); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: '本地协议验收通过' } }] })); }); }); await listen(api);
  const ws = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await new Promise(resolve => ws.once('listening', resolve)); let sentResolve; const sent = new Promise(resolve => { sentResolve = resolve; });
  ws.on('connection', socket => { socket.on('message', bytes => { const call = JSON.parse(bytes); if (call.action === 'send_group_msg') sentResolve(call.params); socket.send(JSON.stringify({ status: 'ok', retcode: 0, echo: call.echo, data: call.action === 'get_login_info' ? { user_id: '100000002' } : { message_id: 99 } })); }); });
  const config = fixture({ transport: { enabled: true, expectedQQ: '100000002', wsUrl: `ws://127.0.0.1:${ws.address().port}` }, model: { baseUrl: `http://127.0.0.1:${api.address().port}/v1`, model: 'fixture-model' } });
  const runtime = new ChatRuntime(config);
  try { await runtime.start(); const peer = [...ws.clients][0]; peer.send(JSON.stringify({ post_type: 'message', ...event() })); const result = await Promise.race([sent, delay(3000).then(() => { throw new Error('pipeline timed out'); })]); assert.equal(result.group_id, '100000003'); assert.equal(result.message[0].data.text, '本地协议验收通过'); }
  finally { await runtime.close(); for (const socket of ws.clients) socket.terminate(); await new Promise(resolve => ws.close(resolve)); await closeHttp(api); }
});

test('unknown inherited config keys cannot mutate object prototypes', () => { assert.throws(() => validateConfig(JSON.parse('{"__proto__":{"polluted":true}}'))); assert.throws(() => validateConfig(JSON.parse('{"constructor":{}}'))); assert.equal({}.polluted, undefined); });
test('token-limit fields are selected explicitly for each compatible provider', async () => { for (const tokenLimitField of ['max_tokens', 'max_completion_tokens']) { let sent; const model = new CompatibleApiModel({ ...DEFAULT_CONFIG.model, tokenLimitField }, { env: { BOT_API_KEY: 'fixture' }, fetchImpl: async (url, options) => { sent = JSON.parse(options.body); return Response.json({ choices: [{ message: { content: 'ok' } }] }); } }); await model.complete([]); assert.equal(sent[tokenLimitField], 600); assert.equal(Object.hasOwn(sent, tokenLimitField === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens'), false); } });
test('model response is bounded and cancellation is separate from timeout', async () => { const model = new CompatibleApiModel(DEFAULT_CONFIG.model, { env: { BOT_API_KEY: 'fixture' }, fetchImpl: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) }); await assert.rejects(model.complete([]), error => error.code === 'model_response_too_large'); const controller = new AbortController(); controller.abort(); const cancelled = new CompatibleApiModel(DEFAULT_CONFIG.model, { env: { BOT_API_KEY: 'fixture' }, fetchImpl: async () => { throw new DOMException('aborted', 'AbortError'); } }); await assert.rejects(cancelled.complete([], { signal: controller.signal }), error => error.code === 'model_cancelled'); });
test('OneBot CQ-string at mention triggers a reply and labels unsupported media honestly', async () => { let prompt; const transport = new MockTransport(), runtime = new ChatRuntime(fixture(), { transport, model: { complete: async messages => { prompt = messages; return { text: '当前只能读文字' }; } } }); await runtime.start(); await runtime.handle(event('', { message: '[CQ:at,qq=100000002]看这个[CQ:image,file=example.png]' })); assert.equal(transport.sent.length, 1); assert.ok(prompt.at(-1).content.includes('当前文本模式不支持识别')); await runtime.close(); });
test('public shared TTS adapters return explicit unavailable instead of reading developer paths', async () => { const { readFatfishVoiceStatus } = await import('../src/shared-voice-status.mjs'); const { generateFatfishSharedVoice } = await import('../src/shared-voice-client.mjs'); assert.equal(readFatfishVoiceStatus().reason, 'tts_adapter_not_configured'); assert.throws(() => generateFatfishSharedVoice('hi'), error => error.code === 'tts_adapter_not_configured'); });
test('OneBot reconnects after closure and explicit close stops further reconnects', async () => { const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await new Promise(resolve => server.once('listening', resolve)); let connections = 0, secondResolve; const second = new Promise(resolve => { secondResolve = resolve; }); server.on('connection', socket => { connections++; if (connections === 1) setTimeout(() => socket.terminate(), 10); else secondResolve(); }); const client = new OneBotClient({ url: `ws://127.0.0.1:${server.address().port}`, reconnect: true }); try { await client.connect(); await Promise.race([second, delay(2500).then(() => { throw new Error('reconnect timed out'); })]); assert.equal(connections, 2); client.close(); await delay(600); assert.equal(connections, 2); } finally { client.close(); for (const peer of server.clients) peer.terminate(); await new Promise(resolve => server.close(resolve)); } });

test('configuration-only CLI starts an owner panel but never contacts an enabled gateway', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fatfish-cli-'));
  fs.cpSync(path.join(ROOT, 'src'), path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'public')); fs.copyFileSync(path.join(ROOT, 'public/template.html'), path.join(root, 'public/template.html'));
  const gateway = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await new Promise(resolve => gateway.once('listening', resolve)); let contacts = 0; gateway.on('connection', () => { contacts++; });
  saveConfig(root, fixture({ panel: { port: 0 }, transport: { enabled: true, expectedQQ: '100000002', wsUrl: `ws://127.0.0.1:${gateway.address().port}` } }));
  const child = spawn(process.execPath, [path.join(root, 'src/main.mjs'), 'panel'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const exited = new Promise(resolve => child.once('exit', resolve)); let buffer = '';
  const ready = new Promise((resolve, reject) => { child.stdout.on('data', bytes => { buffer += bytes; const match = buffer.match(/Local owner panel: (http:\/\/127\.0\.0\.1:\d+)\/#([a-f0-9]{64})/); if (match) resolve({ url: match[1], token: match[2] }); }); child.once('error', reject); child.once('exit', () => reject(new Error('CLI exited before panel readiness'))); });
  try {
    const panel = await Promise.race([ready, delay(5000).then(() => { throw new Error('panel readiness timed out'); })]);
    const response = await fetch(`${panel.url}/api/status`, { headers: { Authorization: `Bearer ${panel.token}` } }); assert.equal(response.status, 200);
    assert.equal((await response.json()).transport, 'disabled_configuration_mode'); await delay(100); assert.equal(contacts, 0);
    const headers = { Authorization: `Bearer ${panel.token}`, Origin: panel.url, 'x-csrf-token': panel.token, 'content-type': 'application/json' };
    const initial = await fetch(`${panel.url}/api/config`, { headers }).then(r => r.json());
    for (const kind of ['model', 'transport']) {
      const invalid = structuredClone(initial); invalid[kind].adapter = 'not-registered';
      assert.equal((await fetch(`${panel.url}/api/config`, { method: 'PUT', headers, body: JSON.stringify(invalid) })).status, 400);
      assert.deepEqual(await fetch(`${panel.url}/api/config`, { headers }).then(r => r.json()), initial);
      assert.deepEqual(readConfig(root), initial);
    }
    const updated = structuredClone(initial); updated.bot.name = 'CLI Hot Update';
    assert.equal((await fetch(`${panel.url}/api/config`, { method: 'PUT', headers, body: JSON.stringify(updated) })).status, 200);
    assert.deepEqual(await fetch(`${panel.url}/api/config`, { headers }).then(r => r.json()), updated); assert.deepEqual(readConfig(root), updated);
    assert.equal((await fetch(`${panel.url}/api/status`, { headers }).then(r => r.json())).transport, 'disabled_configuration_mode'); assert.equal(contacts, 0);
  } finally { child.kill(); await exited; for (const peer of gateway.clients) peer.terminate(); await new Promise(resolve => gateway.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); }
});

test('account switch during a model turn is rechecked before the send action', async () => { const transport = new MockTransport(); const runtime = new ChatRuntime(fixture(), { transport, model: { complete: async () => { transport.id = '100000099'; return { text: 'must not send from another account' }; } } }); await runtime.start(); const result = await runtime.handle(event()); assert.equal(result.error, 'gateway_identity_unverified'); assert.equal(transport.sent.length, 0); assert.equal(runtime.status().identity, 'mismatch_or_unavailable'); await runtime.close(); });

test('failed persistence and missing adapter preserve active runtime, GET config and disk; successful hot update agrees', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fatfish-transaction-')); const config = validateConfig({ panel: { port: 0 } }); saveConfig(root, config);
  let active = new ChatRuntime(config), writeFailure = false, disposed = 0; const original = active;
  const panel = await startPanel({ root, config, token: 'fixture-owner-token', status: () => active.status(), probe: async () => ({ actualModelReply: true }), persist: (folder, next) => { if (writeFailure) throw Object.assign(new Error('synthetic disk failure'), { code: 'EACCES' }); return saveConfig(folder, next); }, prepare: async next => {
    const candidate = new ChatRuntime(next); return { dispose: async () => { disposed++; await candidate.close(); }, commit: () => { const old = active; active = candidate; void old.close(); } };
  } });
  const headers = { Authorization: 'Bearer fixture-owner-token', Origin: panel.url, 'x-csrf-token': 'fixture-owner-token', 'content-type': 'application/json' };
  const put = next => fetch(`${panel.url}/api/config`, { method: 'PUT', headers, body: JSON.stringify(next) });
  const current = () => fetch(`${panel.url}/api/config`, { headers }).then(response => response.json());
  try {
    const invalid = structuredClone(config); invalid.model.adapter = 'nonexistent-adapter'; assert.equal((await put(invalid)).status, 400);
    assert.equal(active, original); assert.equal(original.closed, false); assert.deepEqual(await current(), config); assert.deepEqual(readConfig(root), config);
    const next = structuredClone(config); next.bot.name = 'Updated Character'; next.allow.groups = ['100000033']; writeFailure = true;
    assert.equal((await put(next)).status, 500); assert.equal(active, original); assert.equal(original.closed, false); assert.equal(disposed, 1); assert.deepEqual(await current(), config); assert.deepEqual(readConfig(root), config);
    writeFailure = false; assert.equal((await put(next)).status, 200); assert.notEqual(active, original); assert.equal(original.closed, true); assert.equal(active.config.bot.name, 'Updated Character'); assert.deepEqual(await current(), next); assert.deepEqual(readConfig(root), next);
  } finally { await panel.close(); await active.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
test('model probe enforces JSON type, syntax, object shape and 64KiB before invoking the model', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fatfish-probe-body-')); let calls = 0;
  const panel = await startPanel({ root, config: validateConfig({ panel: { port: 0 } }), token: 'fixture-owner-token', status: () => ({}), prepare: async () => ({ commit() {} }), probe: async () => { calls++; return { actualModelReply: true }; } });
  const headers = { Authorization: 'Bearer fixture-owner-token', Origin: panel.url, 'x-csrf-token': 'fixture-owner-token', 'content-type': 'application/json' };
  const post = (body, contentType = 'application/json') => fetch(`${panel.url}/api/model/probe`, { method: 'POST', headers: { ...headers, 'content-type': contentType }, body });
  try {
    assert.equal((await post('{}', 'text/plain')).status, 415); assert.equal((await post('{')).status, 400); assert.equal((await post('null')).status, 400); assert.equal((await post('[]')).status, 400); assert.equal((await post('{"extra":true}')).status, 400);
    assert.equal((await post(JSON.stringify({ extra: 'x'.repeat(65536) }))).status, 413); assert.equal(calls, 0);
    assert.equal((await post('{}')).status, 200); assert.equal(calls, 1);
  } finally { await panel.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('trusted transport sees raw gateway events while host never calls the model for an unauthorized scope', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fatfish-raw-transport-')); fs.mkdirSync(path.join(root, 'extensions'));
  fs.writeFileSync(path.join(root, 'extensions', 'raw-transport.mjs'), `import {EventEmitter} from 'node:events';
export default {apiVersion:1,id:'raw-transport',capabilities:['transport:onebot-v11'],setup(){return {dependencies:[],providers:{transports:{'raw-transport':()=>new class extends EventEmitter {
rawEvents=[];sent=[];async connect(){this.emit('open')} async getLoginInfo(){return {user_id:'100000002'}}
onGroupMessage(f){this.on('message:group',f)} onPrivateMessage(f){this.on('message:private',f)}
inject(value){this.rawEvents.push(value);this.emit('message:group',value)}
async sendGroupMessage(id,message){this.sent.push({id,message});return {message_id:'fixture'}} async sendPrivateMessage(){} close(){this.emit('close')}
}}}}}};`);
  const registry = await loadPlugins(root, ['./extensions/raw-transport.mjs']); let calls = 0;
  const runtime = new ChatRuntime(fixture({ transport: { enabled: true, expectedQQ: '100000002', adapter: 'raw-transport' } }), { registry, model: { complete: async () => { calls++; return { text: 'authorized fixture reply' }; } } });
  try {
    await runtime.start(); runtime.transport.inject(event('outside scope fixture', { group_id: '100000099' })); await delay(0);
    assert.equal(runtime.transport.rawEvents.length, 1); assert.equal(runtime.transport.rawEvents[0].group_id, '100000099'); assert.equal(calls, 0); assert.equal(runtime.histories.size, 0); assert.equal(runtime.transport.sent.length, 0);
    runtime.transport.inject(event('小鲸鱼 hello', { message_id: 2 })); await delay(0); assert.equal(calls, 1); assert.equal(runtime.transport.sent.length, 1);
  } finally { await runtime.close(); await registry.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
});
