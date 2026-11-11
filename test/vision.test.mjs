import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import { validateConfig } from '../src/template/config.mjs';
import { ChatRuntime } from '../src/template/runtime.mjs';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+k3ioAAAAASUVORK5CYII=';
const photo = { type: 'image', data: { file: 'photo.png' } };
const ask = { type: 'text', data: { text: '小鲸鱼，刚才那张图里有什么？' } };
const group = '100000003', second = '100000005', owner = '100000004', bot = '100000002';
const parts = body => body.messages.at(-1).content;

async function setup(t, { visionEnabled = true, imageCacheRoot = '', image = () => ({ base64: png }) } = {}) {
  const calls = [], requests = [];
  const model = http.createServer(async (req, res) => {
    const bytes = [];
    for await (const data of req) bytes.push(data);
    requests.push(JSON.parse(Buffer.concat(bytes)));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: '收到本轮内容' } }] }));
  });
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  const ws = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => ws.once('listening', resolve));
  ws.on('connection', socket => socket.on('message', async bytes => {
    const call = JSON.parse(bytes);
    calls.push(call);
    let data = { message_id: 100 };
    if (call.action === 'get_login_info') data = { user_id: bot };
    if (call.action === 'get_image') data = await image(call.params.file);
    socket.send(JSON.stringify({ echo: call.echo, retcode: 0, status: 'ok', data }));
  }));
  const config = validateConfig({
    transport: { expectedQQ: bot, enabled: true, wsUrl: 'ws://127.0.0.1:' + ws.address().port, imageCacheRoot },
    model: { model: 'multimodal-fixture', baseUrl: 'http://127.0.0.1:' + model.address().port + '/v1', visionEnabled },
    context: { sharedAcrossScopes: true }, allow: { groups: [group, second], private: [owner] },
  });
  const runtime = new ChatRuntime(config);
  t.after(async () => {
    await runtime.close();
    for (const client of ws.clients) client.terminate();
    await new Promise(resolve => ws.close(resolve));
    await new Promise(resolve => model.close(resolve));
  });
  await runtime.start();
  let consumed, seq = 0;
  const original = runtime.handle.bind(runtime);
  runtime.handle = event => {
    const turn = original(event);
    consumed.resolve(turn);
    return turn;
  };
  function send(message, changes = {}) {
    consumed = Promise.withResolvers();
    [...ws.clients][0].send(JSON.stringify({ post_type: 'message', message_type: 'group', self_id: bot, group_id: group,
      user_id: owner, message_id: ++seq, message, ...changes }));
    return consumed.promise;
  }
  return { send, config, runtime, calls, requests };
}

test('an authorized group image takes the WS -> multimodal HTTP -> exact group route', async t => {
  const f = await setup(t);
  assert.equal((await f.send([ask, photo])).sent, true);
  assert.equal(f.requests[0].model, 'multimodal-fixture');
  assert.deepEqual(parts(f.requests[0])[1], { type: 'image_url', image_url: { url: 'data:image/png;base64,' + png } });
  assert.equal(f.calls.find(c => c.action === 'send_group_msg').params.group_id, group);
  assert.equal(f.runtime.status().lastImageInput, 'attached');
  assert.ok(!JSON.stringify([...f.runtime.histories]).includes(png));
});

test('recent photo reference stays in its chat even when text history is shared', async t => {
  const f = await setup(t);
  assert.equal((await f.send([photo])).ignored, 'not_triggered');
  assert.equal(f.calls.filter(c => c.action === 'get_image').length, 0);
  await f.send([ask], { group_id: second });
  assert.equal(typeof parts(f.requests[0]), 'string');
  await f.send([ask]);
  assert.equal(parts(f.requests[1])[1].image_url.url, 'data:image/png;base64,' + png);
  await f.send([{ type: 'reply', data: { id: '999' } }, ask]);
  assert.equal(typeof parts(f.requests[2]), 'string');
  await f.send('[CQ:reply,id=1]小鲸鱼，看看');
  assert.equal(parts(f.requests[3])[1].type, 'image_url');
  f.runtime.now = () => Date.now() + 121000;
  await f.send([ask]);
  assert.equal(typeof parts(f.requests[4]), 'string');
});

test('private CQ image is accepted, URLs and file paths from messages cannot be fetched', async t => {
  const f = await setup(t);
  await f.send('[CQ:image,file=photo.png]', { message_type: 'private' });
  assert.equal(parts(f.requests[0])[1].type, 'image_url');
  assert.equal(f.calls.find(c => c.action === 'send_private_msg').params.user_id, owner);
  await f.send([ask, { type: 'image', data: { file: '../private.png', url: 'http://127.0.0.1/private' } }]);
  await f.send('小鲸鱼[CQ:image,file=https://example.invalid/image]');
  assert.deepEqual(f.calls.filter(c => c.action === 'get_image').map(c => c.params.file), ['photo.png']);
  assert.equal(typeof parts(f.requests[1]), 'string');
  assert.equal(typeof parts(f.requests[2]), 'string');
});

test('disabled vision, unauthorized targets and wrong account perform no media lookup', async t => {
  const f = await setup(t, { visionEnabled: false });
  assert.equal(f.runtime.status().capabilities.vision, false);
  await f.send([ask, photo]);
  assert.equal(typeof parts(f.requests[0]), 'string');
  const denied = await setup(t);
  await denied.send([ask, photo], { group_id: '999990001' });
  await denied.send([ask, photo], { self_id: '999990002' });
  assert.equal(denied.requests.length, 0);
  for (const item of [f, denied]) assert.equal(item.calls.filter(c => c.action === 'get_image').length, 0);
});

test('standard gateway file replies are restricted to a dedicated directory and image size/type', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'OneBot 图片-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const cache = path.join(temp, 'cache');
  await fs.mkdir(cache);
  const file = path.join(cache, 'good.png');
  const outside = path.join(temp, 'outside.png');
  await fs.writeFile(file, Buffer.from(png, 'base64'));
  await fs.writeFile(outside, Buffer.from(png, 'base64'));
  const replies = [{file, base64: ''}, {file: outside}, {url: 'http://127.0.0.1/private'}, {base64: Buffer.from('not an image').toString('base64')},
    {base64: 'A'.repeat(3 * 1024 * 1024)}];
  const f = await setup(t, { imageCacheRoot: cache, image: () => replies.shift() });
  for (let i = 0; i < 5; i++) await f.send([ask, photo]);
  assert.equal(parts(f.requests[0])[1].image_url.url, 'data:image/png;base64,' + png);
  for (const body of f.requests.slice(1)) assert.equal(typeof parts(body), 'string');
});

test('configuration revocation during image lookup prevents the model request and QQ send', async t => {
  const started = Promise.withResolvers(), finish = Promise.withResolvers();
  const f = await setup(t, { image: () => { started.resolve(); return finish.promise; } });
  const turn = f.send([ask, photo]);
  await started.promise;
  f.runtime.reconfigure(validateConfig({ allow: { groups: [] } }));
  finish.resolve({ base64: png });
  assert.equal((await turn).ignored, 'configuration_changed');
  assert.equal(f.requests.length, 0);
  assert.equal(f.calls.filter(c => c.action.startsWith('send_')).length, 0);
});
