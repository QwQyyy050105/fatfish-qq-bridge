import { EventEmitter } from 'node:events';
import { validateConfig } from './config.mjs';
import { ChatRuntime } from './runtime.mjs';
export class MockTransport extends EventEmitter {
  constructor(id = '100000002') { super(); this.id = id; this.sent = []; }
  onPrivateMessage(f) { this.on('private', f); } onGroupMessage(f) { this.on('group', f); }
  async connect() { this.emit('open'); } async getLoginInfo() { return { user_id: this.id }; }
  async sendGroupMessage(id, message) { this.sent.push({ type: 'group', id, message }); return { message_id: this.sent.length }; }
  async sendPrivateMessage(id, message) { this.sent.push({ type: 'private', id, message }); return { message_id: this.sent.length }; }
  close() { this.emit('close'); }
}
export async function runDemo() {
  const config = validateConfig({ transport: { enabled: true, expectedQQ: '100000002' }, allow: { groups: ['100000003'] } });
  const transport = new MockTransport(), model = { capabilities: { text: true, tools: false, vision: false, asr: false, tts: false }, complete: async messages => ({ text: `在呢 我听到你问${messages.at(-1).content.split(': ').slice(1).join(': ')}` }) };
  const runtime = new ChatRuntime(config, { transport, model }); await runtime.start();
  const event = { self_id: '100000002', message_type: 'group', group_id: '100000003', user_id: '100000004', sender: { nickname: 'Example Member' }, message_id: 1, message: [{ type: 'text', data: { text: '小鲸鱼，连接怎么样' } }] };
  await runtime.handle({ ...event, group_id: '100000099' }); await runtime.handle(event); await runtime.handle(event);
  const result = { demo: true, network: false, externalProcesses: false, authorizedReplies: transport.sent.length, duplicateSuppressed: transport.sent.length === 1, outsideScopeBlocked: !transport.sent.some(s => s.id === '100000099'), status: runtime.status() };
  await runtime.close(); if (result.authorizedReplies !== 1 || !result.outsideScopeBlocked) throw new Error('Demo verification failed'); return result;
}
