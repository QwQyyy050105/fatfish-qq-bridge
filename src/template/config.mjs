import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
export const DEFAULT_CONFIG = {
  schemaVersion: 1,
  bot: { name: '小鲸鱼', aliases: ['小鲸鱼', '大肥鱼'], persona: '你是小鲸鱼，一个有主见、喜欢接梗的群聊伙伴。先看清谁在说什么；没听懂就自然问一句。聊天简短随意，不要客服套话，不编造见闻。', style: 'casual', maxReplyChars: 450 },
  participation: { mode: 'mentioned', followupSeconds: 180, probability: 0, quietHours: { enabled: false, start: 23, end: 8 } },
  context: { maxMessages: 60, maxChars: 18000, sharedAcrossScopes: false },
  allow: { groups: [], private: [] },
  transport: { adapter: 'onebot-v11', enabled: false, expectedQQ: '', wsUrl: 'ws://127.0.0.1:3001', tokenEnv: 'ONEBOT_ACCESS_TOKEN', allowRemote: false },
  model: { adapter: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'your-model-id', keyEnv: 'BOT_API_KEY', tokenLimitField: 'max_tokens', timeoutMs: 45000, maxCompletionTokens: 600 },
  panel: { host: '127.0.0.1', port: 3100, title: 'Fatfish Console', accent: '#3988ff', compact: false },
  plugins: []
};
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function merge(a, b) { const out = structuredClone(a); for (const [key, value] of Object.entries(b ?? {})) { if (!Object.hasOwn(a, key)) throw new Error(`Unknown config field: ${key}`); out[key] = object(value) && object(a[key]) ? merge(a[key], value) : value; } return out; }
const requireValue = (condition, label) => { if (!condition) throw new Error(`Invalid config: ${label}`); };
const bounded = (v, low, high) => Number.isInteger(v) && v >= low && v <= high;
export function validateConfig(input = {}) {
  requireValue(object(input), 'object'); const c = merge(DEFAULT_CONFIG, input);
  requireValue(c.schemaVersion === 1, 'schemaVersion');
  requireValue(typeof c.bot.name === 'string' && c.bot.name.length > 0 && c.bot.name.length <= 60, 'bot.name');
  requireValue(Array.isArray(c.bot.aliases) && c.bot.aliases.length <= 20 && c.bot.aliases.every(x => typeof x === 'string' && x.trim() && x.length <= 60), 'bot.aliases');
  requireValue(typeof c.bot.persona === 'string' && c.bot.persona.length <= 12000, 'bot.persona');
  requireValue(['casual', 'concise', 'detailed'].includes(c.bot.style), 'bot.style'); requireValue(bounded(c.bot.maxReplyChars, 20, 4000), 'bot.maxReplyChars');
  requireValue(['mentioned', 'active'].includes(c.participation.mode), 'participation.mode'); requireValue(bounded(c.participation.followupSeconds, 0, 3600), 'participation.followupSeconds');
  requireValue(Number.isFinite(c.participation.probability) && c.participation.probability >= 0 && c.participation.probability <= 1, 'participation.probability');
  requireValue(typeof c.participation.quietHours.enabled === 'boolean' && bounded(c.participation.quietHours.start, 0, 23) && bounded(c.participation.quietHours.end, 0, 23), 'participation.quietHours');
  requireValue(bounded(c.context.maxMessages, 2, 500) && bounded(c.context.maxChars, 1000, 200000) && typeof c.context.sharedAcrossScopes === 'boolean', 'context');
  for (const type of ['groups', 'private']) requireValue(Array.isArray(c.allow[type]) && c.allow[type].length <= 1000 && c.allow[type].every(id => typeof id === 'string' && /^\d{5,16}$/.test(id)), `allow.${type}`);
  requireValue(typeof c.transport.enabled === 'boolean' && typeof c.transport.allowRemote === 'boolean', 'transport.enabled'); requireValue(typeof c.transport.expectedQQ === 'string' && (c.transport.expectedQQ === '' || /^\d{5,16}$/.test(c.transport.expectedQQ)), 'transport.expectedQQ');
  for (const [key, env] of [['transport.tokenEnv', c.transport.tokenEnv], ['model.keyEnv', c.model.keyEnv]]) requireValue(/^[A-Z][A-Z0-9_]{0,79}$/.test(env), key);
  const ws = new URL(c.transport.wsUrl); requireValue(['ws:', 'wss:'].includes(ws.protocol) && !ws.username && !ws.password && !ws.search && !ws.hash, 'transport.wsUrl');
  if (!c.transport.allowRemote) requireValue(['127.0.0.1', 'localhost', '[::1]'].includes(ws.hostname), 'transport.wsUrl must be loopback unless allowRemote');
  if (c.transport.allowRemote) requireValue(ws.protocol === 'wss:', 'remote gateway requires wss');
  const api = new URL(c.model.baseUrl); requireValue((api.protocol === 'https:' || (api.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname))) && !api.username && !api.password && !api.search && !api.hash, 'model.baseUrl');
  requireValue(['max_tokens', 'max_completion_tokens'].includes(c.model.tokenLimitField), 'model.tokenLimitField');
  requireValue(typeof c.model.model === 'string' && c.model.model.trim() && c.model.model.length <= 200, 'model.model'); requireValue(bounded(c.model.timeoutMs, 1000, 180000) && bounded(c.model.maxCompletionTokens, 16, 16000), 'model limits');
  requireValue(typeof c.transport.adapter === 'string' && typeof c.model.adapter === 'string', 'adapters');
  requireValue(c.panel.host === '127.0.0.1' && bounded(c.panel.port, 0, 65535) && typeof c.panel.title === 'string' && c.panel.title.length <= 100 && /^#[a-f\d]{6}$/i.test(c.panel.accent) && typeof c.panel.compact === 'boolean', 'panel');
  requireValue(Array.isArray(c.plugins) && c.plugins.length <= 30 && c.plugins.every(v => typeof v === 'string' && v.startsWith('./extensions/') && v.endsWith('.mjs') && !v.includes('..')), 'plugins must be owner-configured ./extensions/*.mjs');
  return c;
}
export function readConfig(root) { const file = path.join(root, 'template.config.json'); return validateConfig(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}); }
export function saveConfig(root, input) { const config = validateConfig(input); const file = path.join(root, 'template.config.json'); const temp = `${file}.${process.pid}.${randomUUID()}.tmp`; try { fs.writeFileSync(temp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, file); return config; } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); } }
export function panelToken(root) { const directory = path.join(root, 'state'); fs.mkdirSync(directory, { recursive: true }); const filename = path.join(directory, 'panel-token'); if (!fs.existsSync(filename)) { try { fs.writeFileSync(filename, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; } } return fs.readFileSync(filename, 'utf8').trim(); }
export function configurationIssues(c, env = process.env) {
  const issues = []; if (!c.transport.enabled) issues.push('transport_disabled'); if (!c.transport.expectedQQ) issues.push('expected_account_not_configured'); if (!c.allow.groups.length && !c.allow.private.length) issues.push('no_authorized_targets');
  if (new URL(c.model.baseUrl).hostname.endsWith('example.com') || c.model.model === 'your-model-id') issues.push('model_not_configured');
  if (!env[c.model.keyEnv] && new URL(c.model.baseUrl).protocol === 'https:') issues.push('model_key_environment_missing'); return issues;
}
