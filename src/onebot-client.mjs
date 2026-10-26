// Independent implementation of the public OneBot v11 forward WebSocket protocol.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import createJsonParser from 'json-bigint';
const wireJson = createJsonParser({ storeAsString: true, protoAction: 'error', constructorAction: 'error' });
export const text = value => ({ type: 'text', data: { text: String(value) } });
export class OneBotError extends Error { constructor(code, action = '') { super(`OneBot ${code}${action ? ` (${action})` : ''}`); this.code = code; } }
export class OneBotClient extends EventEmitter {
  constructor({ url, accessToken = '', reconnect = true, requestTimeoutMs = 10000, WebSocketImpl = WebSocket } = {}) {
    super(); const endpoint = new URL(url);
    if (!['ws:', 'wss:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new OneBotError('invalid_endpoint');
    this.url = endpoint.href; this.accessToken = accessToken; this.reconnect = reconnect; this.requestTimeoutMs = requestTimeoutMs; this.WebSocketImpl = WebSocketImpl;
    this.pending = new Map(); this.closed = false; this.attempt = 0;
  }
  connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.closed = false;
    this.connecting = new Promise((resolve, reject) => {
      let settled = false;
      const socket = new this.WebSocketImpl(this.url, { headers: this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}, maxPayload: 8 * 1024 * 1024, handshakeTimeout: this.requestTimeoutMs });
      this.socket = socket;
      socket.on('open', () => { settled = true; this.attempt = 0; this.emit('open'); resolve(); });
      socket.on('message', bytes => {
        let packet; try { packet = wireJson.parse(bytes.toString()); } catch { return; }
        if (packet.echo !== undefined && this.pending.has(String(packet.echo))) {
          const request = this.pending.get(String(packet.echo)); this.pending.delete(String(packet.echo)); clearTimeout(request.timer);
          if (packet.status !== 'ok' || (packet.retcode !== undefined && packet.retcode !== 0)) request.reject(new OneBotError(`retcode_${Number(packet.retcode) || 'failed'}`, request.action)); else request.resolve(packet);
          return;
        }
        if (typeof packet.post_type !== 'string') return;
        this.emit('event', packet);
        if (packet.post_type === 'message') this.emit(`message:${packet.message_type}`, packet);
        if (packet.post_type === 'notice') this.emit(`notice:${packet.notice_type}`, packet);
        if (packet.post_type === 'meta_event' && packet.meta_event_type === 'heartbeat') this.emit('bot_status', packet.status ?? {});
      });
      socket.on('error', () => { const error = new OneBotError('connection_error'); if (this.listenerCount('error')) this.emit('error', error); if (!settled) { settled = true; reject(error); } });
      socket.on('close', code => {
        if (!settled) { settled = true; reject(new OneBotError('connection_closed')); }
        for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new OneBotError('connection_closed', request.action)); }
        this.pending.clear(); this.emit('close', { code });
        if (this.reconnect && !this.closed) { this.retryTimer = setTimeout(() => this.connect().catch(() => {}), Math.min(30000, 500 * 2 ** Math.min(this.attempt++, 6))); this.retryTimer.unref?.(); }
      });
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
  request(action, params = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new OneBotError('not_connected', action));
    const echo = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(echo); reject(new OneBotError('request_timeout', action)); }, this.requestTimeoutMs);
      this.pending.set(echo, { resolve, reject, timer, action });
      this.socket.send(JSON.stringify({ action, params, echo }), error => { if (error && this.pending.delete(echo)) { clearTimeout(timer); reject(new OneBotError('send_failed', action)); } });
    });
  }
  async raw(action, params) { return (await this.request(action, params)).data; }
  getLoginInfo() { return this.raw('get_login_info'); } getStatus() { return this.raw('get_status'); }
  sendGroupMessage(group_id, message) { return this.raw('send_group_msg', { group_id, message: Array.isArray(message) ? message : [typeof message === 'string' ? text(message) : message] }); }
  sendPrivateMessage(user_id, message) { return this.raw('send_private_msg', { user_id, message: Array.isArray(message) ? message : [typeof message === 'string' ? text(message) : message] }); }
  getImage(file) { return this.raw('get_image', typeof file === 'object' ? file : { file }); }
  fetchFaceEntity(emoji_id) { return this.raw('fetch_custom_face', { emoji_id }); } // optional extension
  getGroupMemberList(group_id) { return this.raw('get_group_member_list', { group_id }); }
  getGroupMemberInfo(group_id, user_id, no_cache = false) { return this.raw('get_group_member_info', { group_id, user_id, no_cache }); }
  getMessage(message_id) { return this.raw('get_msg', { message_id }); }
  onPrivateMessage(f) { return this.on('message:private', f); } onGroupMessage(f) { return this.on('message:group', f); }
  onNotice(type, f) { return this.on(`notice:${type}`, f); } onEvent(f) { return this.on('event', f); } onBotStatus(f) { return this.on('bot_status', f); }
  close() { this.closed = true; clearTimeout(this.retryTimer); this.socket?.close(); }
}
