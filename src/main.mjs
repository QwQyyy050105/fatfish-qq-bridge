import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, saveConfig, DEFAULT_CONFIG, configurationIssues, panelToken } from './template/config.mjs';
import { loadPlugins } from './template/plugins.mjs';
import { ChatRuntime } from './template/runtime.mjs';
import { startPanel } from './template/panel.mjs';
import { runDemo } from './template/demo.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2] ?? 'start';
if (command === 'demo') console.log(JSON.stringify(await runDemo(), null, 2));
else if (command === 'init') {
  if (fs.existsSync(path.join(ROOT, 'template.config.json'))) console.log('template.config.json already exists; preserved.');
  else { saveConfig(ROOT, DEFAULT_CONFIG); console.log('Created template.config.json. Edit it or use npm start to open the local panel.'); }
} else if (command === 'doctor') {
  try {
    const config = readConfig(ROOT), issues = configurationIssues(config);
    const report = { schemaVersion: 1, status: issues.length ? 'configuration_required' : 'configured_not_connected', node: process.version, platform: process.platform, transport: { adapter: config.transport.adapter, enabled: config.transport.enabled, verified: false }, model: { adapter: config.model.adapter, verified: false }, issues, checksPerformed: ['local_configuration_only'], capabilities: { windows: 'supported_with_external_onebot_gateway', otherDesktop: 'protocol_portable_gateway_validation_required', mobile: 'unsupported', vision: 'unsupported_in_direct_api_mode', asr: 'unsupported', tts: 'unsupported' } };
    console.log(JSON.stringify(report, null, 2));
  } catch { console.log(JSON.stringify({ status: 'invalid_configuration', issues: ['config_parse_or_validation_failed'], checksPerformed: ['local_configuration_only'] }, null, 2)); process.exitCode = 1; }
} else if (command === 'start' || command === 'panel') {
  let config = readConfig(ROOT);
  const registry = await loadPlugins(ROOT, config.plugins, { log: item => console.log(JSON.stringify(item)) });
  let runtime = new ChatRuntime(config, { registry, log: item => console.log(JSON.stringify(item)) });
  const configurationOnly = command === 'panel';
  const connect = () => {
    if (configurationOnly) { runtime.health.transport = 'disabled_configuration_mode'; return Promise.resolve(); }
    runtime.health.transport = config.transport.enabled ? 'connecting' : 'disabled';
    return runtime.start().catch(() => console.log('Gateway connection unavailable; see /api/status. No group notification was sent.'));
  };
  const token = panelToken(ROOT);
  const panel = await startPanel({ root: ROOT, config, token, status: () => ({ ...runtime.status(), configuration: configurationIssues(config), plugins: registry.loaded }), prepare: async next => {
    // Construction validates registered adapters before persistence or teardown.
    const candidate = new ChatRuntime(next, { registry, log: item => console.log(JSON.stringify(item)) });
    if (typeof candidate.model?.complete !== 'function') { await candidate.close(); throw new Error('Invalid model provider'); }
    return {
      dispose: () => candidate.close(),
      commit: () => {
        const previous = runtime; config = next; runtime = candidate;
        // close marks old work cancelled synchronously; operational cleanup and
        // reconnect run after publication and cannot turn a saved config into 400.
        void previous.close().catch(() => console.log('Previous runtime cleanup failed.'));
        queueMicrotask(() => { void connect(); });
      }
    };
  }, probe: async () => {
    const started = Date.now(), result = await runtime.model.complete([{ role: 'user', content: 'Reply with exactly OK. This is a connection test.' }]);
    return { actualModelReply: Boolean(result.text), durationMs: Date.now() - started, transportTested: false };
  } });
  console.log(`Local owner panel: ${panel.url}/#${token}`);
  console.log('The # token grants local owner access. Do not publish it or the state directory.');
  if (configurationOnly) console.log('Configuration-only mode: QQ connection remains disabled until npm start.');
  void connect();
  let closing = false; const close = async () => { if (closing) return; closing = true; await runtime.close(); await panel.close(); await registry.dispose(); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void close().then(() => process.exit(0)); });
} else { console.error('Usage: node src/main.mjs [init|start|panel|doctor|demo]'); process.exitCode = 1; }
