import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { validateConfig, saveConfig } from './config.mjs';
const equal = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const bodyError = (status, code) => Object.assign(new Error(code), { status });
function readJson(req) {
  if (!String(req.headers['content-type']).startsWith('application/json')) { req.resume(); return Promise.reject(bodyError(415, 'json_required')); }
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, settled = false;
    const fail = error => { if (!settled) { settled = true; reject(error); } };
    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > 65536) { chunks.length = 0; fail(bodyError(413, 'body_too_large')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); settled = true; resolve(body); }
      catch { fail(bodyError(400, 'invalid_json')); }
    });
    req.on('error', () => fail(bodyError(400, 'invalid_body')));
    req.on('aborted', () => fail(bodyError(400, 'invalid_body')));
  });
}
// prepare(next) constructs/validates a replacement without changing active state.
// It returns {commit():void, dispose?():Promise<void>}. commit only publishes the
// already-built replacement and must not perform fallible I/O or provider setup.
export async function startPanel({ root, config, token, status, prepare, probe, persist = saveConfig }) {
  let current = config; let applying = false; let probeInFlight;
  const server = http.createServer(async (req, res) => {
    const reply = (code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)); };
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const expectedHost = `127.0.0.1:${server.address().port}`;
    if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== `http://${expectedHost}`)) return reply(403, { error: 'cross_origin_rejected' });
    if (req.headers.host !== expectedHost) return reply(403, { error: 'invalid_host' });
    if (req.url === '/' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'", 'x-content-type-options': 'nosniff' });
      return res.end(fs.readFileSync(path.join(root, 'public', 'template.html')));
    }
    if (!equal(req.headers.authorization, `Bearer ${token}`)) return reply(401, { error: 'owner_token_required' });
    if (req.method !== 'GET' && (req.headers.origin !== `http://${expectedHost}` || !equal(req.headers['x-csrf-token'], token))) return reply(403, { error: 'csrf_check_failed' });
    if (req.url === '/api/status' && req.method === 'GET') return reply(200, status());
    if (req.url === '/api/config' && req.method === 'GET') return reply(200, current);
    const isProbe = req.url === '/api/model/probe' && req.method === 'POST';
    const isUpdate = req.url === '/api/config' && req.method === 'PUT';
    if (!isProbe && !isUpdate) return reply(404, { error: 'not_found' });
    let body;
    try { body = await readJson(req); }
    catch (error) { return reply(error.status ?? 400, { error: error.message }); }
    if (isProbe) {
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) return reply(400, { error: 'probe_requires_empty_object' });
      try { if (!probeInFlight) probeInFlight = Promise.resolve().then(probe).finally(() => { probeInFlight = null; }); return reply(200, await probeInFlight); }
      catch { return reply(502, { error: 'model_probe_failed' }); }
    }
    if (applying) return reply(409, { error: 'configuration_update_in_progress' });
    applying = true; let prepared, persisted = false;
    try {
      const next = validateConfig(body);
      if (JSON.stringify(next.plugins) !== JSON.stringify(current.plugins) || next.panel.host !== current.panel.host || next.panel.port !== current.panel.port) return reply(400, { error: 'plugins_or_panel_address_require_file_edit' });
      prepared = await prepare(next);
      if (!prepared || typeof prepared.commit !== 'function') throw new Error('invalid_preparation');
      try { persist(root, next); persisted = true; }
      catch { return reply(500, { error: 'configuration_persistence_failed' }); }
      // No provider setup, external connection or disk writes occur in commit.
      prepared.commit(); current = next;
      return reply(200, { saved: true, config: current });
    } catch { return reply(400, { error: 'invalid_configuration' }); }
    finally { if (prepared && !persisted) { try { await prepared.dispose?.(); } catch {} } applying = false; }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(current.panel.port, current.panel.host, resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
