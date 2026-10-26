// Explicit offline allowlist. No real account, cloud probe or platform process is used.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const temp = path.join(root, '.test_tmp'); fs.mkdirSync(temp, { recursive: true });
const env = { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp, QQ_BRIDGE_TEST_LIVE: '0', DSH_ALLOW_LOCAL_AUTH_DISCOVERY: '0' };
const runs = [ ['--test', 'src/core/session-router.test.mjs'], ['--test', ...fs.readdirSync(path.join(root, 'test')).filter(f => f.endsWith('.test.mjs')).map(f => path.join('test', f))], ...[
  'test-account-identity.mjs', 'test-state-persistence.mjs', 'test-agent-preset-patches.mjs', 'test-audit-setup.mjs', 'test-audit-setup-guards.mjs',
  'test-audit-bridge.mjs','test-audit-protocol.mjs','test-audit-protocol-helpers.mjs','test-audit-security.mjs','test-audit-security-mcp.mjs','test-audit-regressions.mjs',
  'test-dsh-inbox-projection.mjs','test-md-to-plain.mjs','test-slang-learn.mjs','test-mux-reconnect.mjs','test-token-economy.mjs','test-qq-model-view.mjs','test-qq-preset-contract.mjs',
  'test-reply-wait.mjs','test-preset-prompt.mjs','test-role-card.mjs','test-media-search.mjs','test-issue-regressions.mjs','test-v2-initial-prompt.mjs','test-token-usage.mjs','test-hardening.mjs',
  'test-forward.mjs','test-stickers.mjs','test-qq-mode-plugin.mjs','test-v2-wait.mjs'
].map(name => [path.join('scripts', name)]) ];
let failed = 0;
for (const args of runs) { const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 90000 }); if (result.status !== 0 || result.error) { failed++; console.error(`FAIL ${args.join(' ')}\n${result.stdout}\n${result.stderr}\n${result.error ?? ''}`); } else { console.log(`PASS ${args.join(' ')}`); } }
if (path.dirname(path.resolve(temp)) === root && path.basename(temp) === '.test_tmp') fs.rmSync(temp, { recursive: true, force: true });
console.log(`Offline suites: ${runs.length - failed}/${runs.length} passed`); process.exitCode = failed ? 1 : 0;
