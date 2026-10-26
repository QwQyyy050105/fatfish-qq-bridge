// Discover only loopback listeners owned by the desktop DSH process. No logs or credentials.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runFile = promisify(execFile);

export function localDiscoveryAllowed(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return url.protocol === 'http:' && !url.username && !url.password
      && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && url.pathname === '/' && !url.search && !url.hash;
  } catch { return false; }
}

export function parseDshListeners(processes, sockets) {
  const pids = new Set([...String(processes).matchAll(/^"DeepSeek Harness\.exe","(\d+)"/gmi)]
    .map((match) => match[1]));
  const urls = new Set();
  for (const line of String(sockets).split(/\r?\n/)) {
    const match = line.trim().match(/^TCP\s+(127\.0\.0\.1|\[::1\]):(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i);
    if (!match || !pids.has(match[3])) continue;
    const port = Number(match[2]);
    if (port > 1024 && port <= 65535) urls.add(`http://${match[1]}:${port}`);
  }
  return [...urls];
}

export async function discoverDshEndpoints({ platform = process.platform, run = runFile } = {}) {
  if (platform !== 'win32') return [];
  const options = { windowsHide: true, encoding: 'utf8', timeout: 4000, maxBuffer: 4 * 1024 * 1024 };
  const [processes, sockets] = await Promise.all([
    run('tasklist.exe', ['/FI', 'IMAGENAME eq DeepSeek Harness.exe', '/FO', 'CSV', '/NH'], options),
    run('netstat.exe', ['-ano', '-p', 'tcp'], options),
  ]);
  return parseDshListeners(processes.stdout, sockets.stdout);
}
