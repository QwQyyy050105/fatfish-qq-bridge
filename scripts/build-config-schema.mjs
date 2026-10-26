import fs from 'node:fs';
import { DEFAULT_CONFIG } from '../src/template/config.mjs';
const bounds = {
  'bot.name': [1,60], 'bot.persona':[0,12000], 'bot.maxReplyChars':[20,4000],
  'participation.followupSeconds':[0,3600], 'participation.probability':[0,1], 'participation.quietHours.start':[0,23], 'participation.quietHours.end':[0,23],
  'context.maxMessages':[2,500], 'context.maxChars':[1000,200000], 'model.timeoutMs':[1000,180000], 'model.maxCompletionTokens':[16,16000], 'panel.port':[0,65535], 'panel.title':[0,100]
};
const enums = { 'bot.style':['casual','concise','detailed'], 'participation.mode':['mentioned','active'], 'model.tokenLimitField':['max_tokens','max_completion_tokens'] };
function schema(value, name = '') {
  if (Array.isArray(value)) return { type:'array', items:{ type:'string', ...(['allow.groups','allow.private'].includes(name) ? {pattern:'^\\d{5,16}$'} : {}) }, default:value };
  if (value && typeof value === 'object') return { type:'object', additionalProperties:false, properties:Object.fromEntries(Object.entries(value).map(([key,v]) => [key,schema(v,name ? `${name}.${key}` : key)])) };
  const type = typeof value === 'number' ? (name === 'participation.probability' ? 'number' : 'integer') : typeof value;
  const rule = { type, default:value };
  if (bounds[name]) { const [low,high]=bounds[name]; if(type==='string') Object.assign(rule,{minLength:low,maxLength:high}); else Object.assign(rule,{minimum:low,maximum:high}); }
  if(enums[name])rule.enum=enums[name];
  if(name==='schemaVersion')rule.const=1;
  if(name==='panel.host')rule.const='127.0.0.1';
  if(name==='panel.accent')rule.pattern='^#[a-fA-F0-9]{6}$';
  if(name.endsWith('Env'))rule.pattern='^[A-Z][A-Z0-9_]{0,79}$';
  if(name==='transport.expectedQQ')rule.pattern='^(?:|\\d{5,16})$';
  return rule;
}
const output={ $schema:'https://json-schema.org/draft/2020-12/schema', title:'Fatfish template configuration v1', description:'Editor schema; runtime performs further URL, plugin-path and boundary validation.', ...schema(DEFAULT_CONFIG) };
fs.writeFileSync(new URL('../template.config.schema.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
fs.writeFileSync(new URL('../template.config.example.json',import.meta.url),JSON.stringify(DEFAULT_CONFIG,null,2)+'\n');
