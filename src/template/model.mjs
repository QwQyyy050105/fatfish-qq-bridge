export class ModelError extends Error { constructor(code) { super(code); this.code = code; } }
async function boundedJson(response, limit = 2 * 1024 * 1024) {
  const reader = response.body?.getReader(); if (!reader) throw new ModelError('model_empty_response');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > limit) { await reader.cancel(); throw new ModelError('model_response_too_large'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ModelError('model_invalid_json'); }
}
export class CompatibleApiModel {
  capabilities = { text: true, tools: false, vision: false, asr: false, tts: false, streaming: false };
  constructor(config, { env = process.env, fetchImpl = fetch } = {}) { this.config = config; this.env = env; this.fetch = fetchImpl; }
  async complete(messages, { signal } = {}) {
    const c = this.config, key = this.env[c.keyEnv]; if (!key && new URL(c.baseUrl).protocol === 'https:') throw new ModelError('model_key_environment_missing');
    const timeout = AbortSignal.timeout(c.timeoutMs);
    try {
      const response = await this.fetch(`${c.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { 'content-type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model: c.model, messages, [c.tokenLimitField ?? 'max_tokens']: c.maxCompletionTokens, stream: false })
      });
      if (!response.ok) { await response.body?.cancel(); throw new ModelError(`model_http_${response.status}`); }
      const data = await boundedJson(response), reply = data.choices?.[0]?.message?.content;
      if (typeof reply !== 'string' || !reply.trim()) throw new ModelError('model_empty_response'); return { text: reply.trim(), usage: data.usage ?? null };
    } catch (error) {
      if (signal?.aborted) throw new ModelError('model_cancelled');
      if (timeout.aborted) throw new ModelError('model_timeout');
      if (error instanceof ModelError) throw error;
      throw new ModelError('model_connection_error');
    }
  }
}
export class FailureBackoff {
  constructor({ now = Date.now, baseMs = 2000, maxMs = 60000 } = {}) { this.now = now; this.baseMs = baseMs; this.maxMs = maxMs; this.failures = 0; this.retryAt = 0; this.lastSuccessAt = null; this.lastFailureAt = null; this.error = null; }
  ready() { return this.now() >= this.retryAt; } success() { this.failures = 0; this.retryAt = 0; this.lastSuccessAt = this.now(); this.error = null; }
  failure(code) { this.failures++; this.lastFailureAt = this.now(); this.error = /^[a-z0-9_]+$/.test(code ?? '') ? code : 'model_error'; this.retryAt = this.now() + Math.min(this.maxMs, this.baseMs * 2 ** Math.min(this.failures - 1, 8)); }
  snapshot() { return { state: !this.ready() ? 'backoff' : this.lastSuccessAt ? 'reply_verified' : 'unverified', failures: this.failures, retryAt: this.retryAt, lastSuccessAt: this.lastSuccessAt, lastFailureAt: this.lastFailureAt, error: this.error }; }
}
