import path from 'node:path';
import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { getImageDimensions, isProbablySafeImageFileRef, looksLikeImageBuffer, mimeFromBuffer } from '../safe-fetch.js';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;
const MAX_IMAGES = 2;

export function imageRefs(message) {
  const files = [];
  function add(file) {
    if (typeof file === 'string' && file === file.trim() && files.length < MAX_IMAGES && isProbablySafeImageFileRef(file) && !files.includes(file)) files.push(file);
  }
  if (Array.isArray(message)) {
    for (const segment of message) if (segment?.type === 'image') add(segment.data?.file);
  } else if (typeof message === 'string') {
    for (const match of message.matchAll(/\[CQ:image,([^\]]+)\]/g)) {
      const file = match[1].split(',').find(field => field.startsWith('file='));
      if (file) add(file.slice(5));
    }
  }
  return files;
}

export function replyRef(message) {
  if (Array.isArray(message)) {
    const reply = message.find(segment => segment?.type === 'reply');
    return reply ? String(reply.data?.id ?? '') : null;
  }
  const reply = typeof message === 'string' && message.match(/\[CQ:reply(?:,([^\]]*))?\]/);
  if (!reply) return null;
  return (reply[1] ?? '').split(',').find(field => field.startsWith('id='))?.slice(3) ?? '';
}

function below(root, filename) {
  const relative = path.relative(root, filename);
  return Boolean(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

export function localImageRoot(value) {
  return typeof value === 'string' && (value === '' || (
    path.isAbsolute(value) && !/^[/\\]{2}/.test(value) &&
    path.resolve(value) !== path.parse(path.resolve(value)).root && !value.includes('\0')
  ));
}

async function readCacheFile(root, filename) {
  if (!root || typeof filename !== 'string' || !path.isAbsolute(filename) || /^[/\\]{2}/.test(filename) || !below(root, filename)) return;
  const [directory, resolved] = await Promise.all([realpath(root), realpath(filename)]);
  if (!localImageRoot(directory) || !below(directory, resolved)) return;
  const before = await stat(resolved);
  if (!before.isFile() || !before.size || before.size > MAX_BYTES) return;
  const handle = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const file = await handle.stat();
    if (!file.isFile() || file.dev !== before.dev || file.ino !== before.ino || file.size !== before.size) return;
    const data = Buffer.alloc(file.size);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
      if (!bytesRead) return;
      offset += bytesRead;
    }
    return data;
  } finally {
    await handle.close();
  }
}

export async function readGatewayImage(transport, file, imageCacheRoot) {
  const image = await transport.getImage(file);
  let bytes;
  if (typeof image?.base64 === 'string' && image.base64) {
    const encoded = image.base64;
    if (encoded.length > 4 * Math.ceil(MAX_BYTES / 3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return;
    bytes = Buffer.from(encoded, 'base64');
  } else {
    bytes = await readCacheFile(imageCacheRoot, image?.file);
  }
  if (!bytes || bytes.length > MAX_BYTES || !looksLikeImageBuffer(bytes)) return;
  const size = getImageDimensions(bytes);
  if (!size?.width || !size.height || size.width * size.height > MAX_PIXELS) return;
  return { type: 'image_url', image_url: { url: 'data:' + mimeFromBuffer(bytes) + ';base64,' + bytes.toString('base64') } };
}
