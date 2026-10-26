import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const ALLOWED = new Set(['model:text', 'transport:onebot-v11']);
export async function loadPlugins(root, files, context = {}) {
  const models = new Map(), transports = new Map(), loaded = [], disposers = [];
  for (const file of files) {
    const extensions = fs.realpathSync(path.join(root, 'extensions')), resolved = fs.realpathSync(path.resolve(root, file)), relative = path.relative(extensions, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Plugin escaped extensions directory');
    const manifest = (await import(pathToFileURL(resolved).href)).default;
    if (manifest?.apiVersion !== 1 || !ID.test(manifest.id) || loaded.includes(manifest.id) || typeof manifest.setup !== 'function' || !Array.isArray(manifest.capabilities) || manifest.capabilities.some(c => !ALLOWED.has(c))) throw new Error('Invalid plugin manifest');
    const result = await manifest.setup(Object.freeze({ apiVersion: 1, ...context }));
    if (!result || !Array.isArray(result.dependencies) || !result.providers) throw new Error('Plugin setup must return providers and dependencies');
    for (const [kind, map, capability] of [['models', models, 'model:text'], ['transports', transports, 'transport:onebot-v11']]) for (const [id, provider] of Object.entries(result.providers[kind] ?? {})) {
      if (!manifest.capabilities.includes(capability) || !ID.test(id) || map.has(id) || typeof provider !== 'function') throw new Error('Invalid or undeclared plugin provider'); map.set(id, provider);
    }
    if (result.dispose) disposers.push(result.dispose); loaded.push(manifest.id);
  }
  return { models, transports, loaded, dispose: async () => { for (const dispose of disposers.reverse()) await dispose(); } };
}
