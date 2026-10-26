// Execute both real preset plugins against a captured tools service, without DSH/QQ.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
for (const preset of ['qq-chat', 'qq-chat-v2']) {
  const { apply } = await import(pathToFileURL(path.join(root, 'dsh/agent-presets', preset, 'qq-tool-restrict.mjs')).href);
  let guard;
  const restricted = [];
  apply({ tools: {
    restrict: ({ deny }) => restricted.push(...deny),
    guard: (callback) => { guard = callback; },
  } });
  assert.equal(typeof guard, 'function');
  assert.ok(restricted.includes('dev_install_package'));
  for (const name of ['ask_user_question', 'todo_write', 'mcp__snowluma__qq_send_message',
    'mcp__snowluma-host__snowluma_status', 'mcp__web-search-safe__web_fetch',
    'mcp__social-trends__get_trends', 'mcp__social-trends__get_social_post']) {
    assert.equal(guard({ name }), undefined, `${preset}: expected allowed ${name}`);
  }
  for (const name of ['web_fetch', 'web_search', 'bash', 'read_file', 'dev_future_tool',
    'mcp__untrusted__web_fetch', '', null, undefined]) {
    try { assert.equal(typeof guard({ name }), 'string', `${preset}: must reject ${String(name)}`); }
    catch (error) { failures++; console.error(`FAIL ${error.message}`); }
  }
  console.log(`${preset}: checked allowed tools and denied inherited/local/invalid tools`);
}
// Public launcher is portable and does not perform ACL/process mutations.
import fs from 'node:fs';
{
  const launcher = fs.readFileSync(path.join(root, 'Start_Fatfish.cmd'), 'utf8');
  assert.ok([...launcher].every(c => c.charCodeAt(0) < 128), 'Portable launcher stays ASCII');
  assert.ok(launcher.includes('node --env-file-if-exists=.env src/main.mjs start'));
  assert.ok(!/icacls|taskkill|SnowLuma|[A-Z]:\\/.test(launcher), 'No installation paths or external process controls');
  const bridge = fs.readFileSync(path.join(root, 'src/bridge.js'), 'utf8');
  const startup = bridge.slice(bridge.indexOf('async function main()'), bridge.indexOf('  acquireLock();'));
  assert.ok(startup.includes('isHardened(STATE_DIR)'));
  assert.ok(!startup.includes('hardenStateDirAcl()'));
  console.log('Portable startup: no external installation paths, ACL writes or gateway process controls');
}

// ── 合规不变量 L6：本程序**只探测、不部署** SnowLuma ────────────────────────────────
// 依据：SnowLuma EULA §5.4（中文为准）
//   「除事先取得著作权人的书面授权外……不得复制、修改、单独再分发或再许可该组件。
//     将其并入第三方安装包或 Docker 镜像、**通过自动化脚本部署**，或者将其用于任何商业用途，
//     均须事先取得书面授权。」
// 2026-09-20：`start_snowluma` / `stop_snowluma` 与 `snowluma.allowProcessControl` 已整体移除。
// 这条测试**防止它们（或同类能力）被无意加回来**——本项目唯一一条"删掉的功能不许复活"的约束。
{
  const host = fs.readFileSync(path.join(root, 'src/mcp-host-server.js'), 'utf8');
  // ① 代码里不得再出现进程启停原语（注释中为记录原因可以提，故先剔掉纯注释行）
  const code = host.split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
  for (const bad of ['spawn(', 'taskkill', 'execFileSync', 'child_process']) {
    assert.ok(!code.includes(bad), `mcp-host-server.js 不得再出现「${bad}」（违反 EULA §5.4 的 L6 不变量）`);
  }
  // ② 不得再注册这两个工具
  for (const tool of ['start_snowluma', 'stop_snowluma']) {
    assert.ok(!host.includes(`'${tool}'`), `不得再注册 ${tool}（EULA §5.4）`);
  }
  // ③ 配置项不得复活（代码与模板两侧都查）
  assert.ok(!code.includes('allowProcessControl'), 'mcp-host-server.js 不得再读取 allowProcessControl');
  const example = fs.readFileSync(path.join(root, 'config.example.json'), 'utf8');
  assert.ok(!example.includes('allowProcessControl'), 'config.example.json 不得再提供 allowProcessControl');
  // ④ 只读工具必须还在（别把整个 server 删空）
  assert.ok(host.includes("'snowluma_status'"), 'snowluma_status（只读探活）必须保留');
  // ⑤ 包元数据必须声明许可证（独立复核发现此前缺失）
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.license, 'MIT', 'package.json 必须声明 license 字段');
  console.log('L6 compliance: no SnowLuma process control, no allowProcessControl, license declared');
}

process.exitCode = failures ? 1 : 0;
