import { CompatibleApiModel, FailureBackoff } from './model.mjs';
import { OneBotClient, text } from '../onebot-client.mjs';
const mediaLabel = type => ['image', 'record', 'video', 'file'].includes(type) ? `[收到${type}；当前文本模式不支持识别]` : '';
const content = event => typeof event.message === 'string'
  ? event.message.replace(/\[CQ:([^,\]]+)[^\]]*\]/g, (_, type) => mediaLabel(type)).replaceAll('&#91;', '[').replaceAll('&#93;', ']').replaceAll('&#44;', ',').replaceAll('&amp;', '&')
  : (event.message ?? []).map(s => s.type === 'text' ? s.data?.text ?? '' : mediaLabel(s.type)).join('');
export class ChatRuntime {
  constructor(config, { model, transport, registry, env = process.env, now = Date.now, random = Math.random, log = () => {} } = {}) {
    this.config = config; this.env = env; this.now = now; this.random = random; this.log = log;
    const modelFactory = registry?.models.get(config.model.adapter), transportFactory = registry?.transports.get(config.transport.adapter);
    if (!model && config.model.adapter !== 'openai-compatible' && !modelFactory) throw new Error('Unsupported model adapter');
    if (!transport && config.transport.adapter !== 'onebot-v11' && !transportFactory) throw new Error('Unsupported transport adapter');
    this.model = model ?? (modelFactory ? modelFactory(config.model, { env }) : new CompatibleApiModel(config.model, { env }));
    this.transport = transport ?? (transportFactory ? transportFactory(config.transport, { env }) : new OneBotClient({ url: config.transport.wsUrl, accessToken: env[config.transport.tokenEnv], reconnect: true }));
    this.health = { transport: 'disconnected', identity: 'unverified', controlApi: 'not_applicable', model: 'unverified', sent: 0, received: 0, lastLatencyMs: null, lastError: null };
    this.backoff = new FailureBackoff({ now }); this.histories = new Map(); this.followups = new Map(); this.queues = new Map(); this.seen = new Set(); this.closed = false; this.controllers = new Set(); this.generation = 0;
    this.transport.on('open', () => { this.health.transport = 'connected'; this.verifyIdentity().catch(() => {}); });
    this.transport.on('close', () => { this.health.transport = 'disconnected'; this.health.identity = 'unverified'; });
    this.transport.on('error', () => { this.health.transport = 'error'; this.health.identity = 'unverified'; this.health.lastError = 'gateway_connection_error'; });
    this.transport.onGroupMessage(event => { void this.handle(event).catch(() => { this.health.lastError = 'message_handler_error'; }); });
    this.transport.onPrivateMessage(event => { void this.handle(event).catch(() => { this.health.lastError = 'message_handler_error'; }); });
  }
  async verifyIdentity() {
    try { const info = await this.transport.getLoginInfo(); if (String(info?.user_id) !== this.config.transport.expectedQQ) throw new Error('identity_mismatch'); this.health.identity = 'verified'; }
    catch { this.health.identity = 'mismatch_or_unavailable'; this.health.lastError = 'gateway_identity_unverified'; throw new Error('gateway_identity_unverified'); }
  }
  async start() {
    if (!this.config.transport.enabled) return;
    if (!this.config.transport.expectedQQ || (!this.config.allow.groups.length && !this.config.allow.private.length)) throw new Error('Configure expected account and authorized targets before connecting');
    await this.transport.connect(); await this.verifyIdentity();
  }
  authorized(event) {
    const c = this.config;
    if (!/^\d{5,16}$/.test(String(event.user_id)) || this.closed || !c.transport.enabled || this.health.identity !== 'verified' || String(event.self_id) !== c.transport.expectedQQ || String(event.user_id) === c.transport.expectedQQ) return null;
    if (event.message_type === 'group' && c.allow.groups.includes(String(event.group_id))) return `group:${event.group_id}`;
    if (event.message_type === 'private' && c.allow.private.includes(String(event.user_id))) return `private:${event.user_id}`;
    return null;
  }
  async handle(event) {
    const key = this.authorized(event); if (!key) return { ignored: 'scope_or_identity' }; // Before model/plugin invocation.
    if (event.message_id === undefined) return { ignored: 'missing_message_id' };
    const dedup = `${key}:${event.message_id}`; if (this.seen.has(dedup)) return { ignored: 'duplicate' };
    this.seen.add(dedup); if (this.seen.size > 5000) this.seen.delete(this.seen.values().next().value);
    const message = content(event).trim(); if (!message) return { ignored: 'unsupported_media' };
    this.health.received++; const c = this.config;
    const historyKey = c.context.sharedAcrossScopes ? 'shared' : key, history = this.histories.get(historyKey) ?? [];
    const speaker = String(event.sender?.card || event.sender?.nickname || event.user_id).slice(0, 100);
    history.push({ role: 'user', content: `[${key}] ${speaker} (id=${event.user_id}): ${message.slice(0, c.context.maxChars)}` });
    this.trim(history); this.histories.set(historyKey, history);
    const q = c.participation.quietHours, hour = new Date(this.now()).getHours();
    const quiet = q.enabled && (q.start === q.end || (q.start < q.end ? hour >= q.start && hour < q.end : hour >= q.start || hour < q.end));
    const cqMention = typeof event.message === 'string' && event.message.includes(`[CQ:at,qq=${c.transport.expectedQQ}]`);
    const mentioned = cqMention || c.bot.aliases.some(alias => message.toLowerCase().includes(alias.toLowerCase())) || (Array.isArray(event.message) && event.message.some(s => s.type === 'at' && String(s.data?.qq) === c.transport.expectedQQ));
    const following = this.now() < (this.followups.get(`${key}:${event.user_id}`) ?? 0);
    const triggered = event.message_type === 'private' || mentioned || following || (c.participation.mode === 'active' && this.random() < c.participation.probability);
    if (!triggered || quiet) return { ignored: quiet ? 'quiet_hours' : 'not_triggered' };
    if (mentioned) this.followups.set(`${key}:${event.user_id}`, this.now() + c.participation.followupSeconds * 1000);
    const generation = this.generation;
    const work = (this.queues.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (this.closed || generation !== this.generation || !this.authorized(event)) return { ignored: 'configuration_changed' };
      if (!this.backoff.ready()) return { ignored: 'model_backoff' };
      const started = this.now(), controller = new AbortController(); this.controllers.add(controller); let reply;
      try {
        const messages = [{ role: 'system', content: `${c.bot.persona}\n你的名字：${c.bot.name}。风格：${c.bot.style}。每次最多${c.bot.maxReplyChars}字。带有名字和id的是实际发言人，转述与引用不改变发言人。当前仅有文字输入，媒体占位符不是内容，不能据此描述图片或语音。只输出本轮聊天回复，不输出分析过程。` }, ...structuredClone(history)];
        reply = await this.model.complete(messages, { signal: controller.signal });
        if (this.closed || generation !== this.generation || !this.authorized(event)) return { ignored: 'configuration_changed' };
        if (typeof reply?.text !== 'string' || !reply.text.trim()) throw Object.assign(new Error('model_empty_response'), { code: 'model_empty_response' });
        this.backoff.success(); this.health.model = 'reply_verified';
      } catch (error) {
        if (controller.signal.aborted) return { ignored: 'cancelled' };
        this.backoff.failure(error.code); this.health.model = 'error'; this.health.lastError = this.backoff.error; this.log({ event: 'model_error', key, code: this.backoff.error });
        return { error: this.backoff.error }; // Do not post repeated connection errors into groups.
      } finally { this.controllers.delete(controller); }
      const output = [...reply.text.trim()].slice(0, c.bot.maxReplyChars).join('');
      try {
        // Recheck the active gateway account immediately before each outbound action.
        await this.verifyIdentity();
        if (this.closed || generation !== this.generation || !this.authorized(event)) return { ignored: 'configuration_changed' };
        const id = key.split(':')[1]; if (key.startsWith('group:')) await this.transport.sendGroupMessage(id, text(output)); else await this.transport.sendPrivateMessage(id, text(output));
        history.push({ role: 'assistant', content: `${c.bot.name}: ${output}` }); this.trim(history);
        this.followups.set(`${key}:${event.user_id}`, this.now() + c.participation.followupSeconds * 1000);
        this.health.sent++; this.health.lastLatencyMs = this.now() - started; this.health.lastError = null; return { sent: true };
      } catch { const code = this.health.identity === 'verified' ? 'gateway_send_failed' : 'gateway_identity_unverified'; this.health.lastError = code; return { error: code }; }
    });
    this.queues.set(key, work); work.finally(() => { if (this.queues.get(key) === work) this.queues.delete(key); }); return work;
  }
  trim(history) { const c = this.config.context; while (history.length > c.maxMessages || (history.length > 1 && history.reduce((n, m) => n + m.content.length, 0) > c.maxChars)) history.shift(); }
  status() { return { ...this.health, modelHealth: this.backoff.snapshot(), capabilities: this.model.capabilities ?? { text: true }, activeConversations: this.queues.size, historyPersistence: 'memory_only' }; }
  reconfigure(config) { this.generation++; this.config = config; for (const controller of this.controllers) controller.abort(); this.histories.clear(); this.followups.clear(); this.seen.clear(); }
  async close() { this.closed = true; this.generation++; for (const controller of this.controllers) controller.abort(); this.transport.close(); await Promise.allSettled([...this.queues.values()]); }
}
