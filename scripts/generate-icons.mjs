import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'extension', 'icons');
mkdirSync(iconsDir, { recursive: true });

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createIconPng(size) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size * 0.45;
  const rRing = size * 0.34;

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter none
    for (let x = 0; x < size; x += 1) {
      const idx = rowStart + 1 + x * 4;
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const dist = Math.hypot(dx, dy);

      // Rounded dark slate badge with magenta->cyan ring
      if (dist > rOuter) {
        raw[idx] = 0;
        raw[idx + 1] = 0;
        raw[idx + 2] = 0;
        raw[idx + 3] = 0;
      } else if (dist >= rRing && dist <= rOuter) {
        const t = (x + y) / (2 * size);
        raw[idx] = Math.round(236 * (1 - t) + 34 * t);
        raw[idx + 1] = Math.round(72 * (1 - t) + 211 * t);
        raw[idx + 2] = Math.round(153 * (1 - t) + 238 * t);
        raw[idx + 3] = 255;
      } else {
        // Dark interior with checkmark dot
        const checkDist = Math.hypot(x - cx, y - cy);
        if (checkDist < size * 0.14) {
          raw[idx] = 34;
          raw[idx + 1] = 211;
          raw[idx + 2] = 238;
          raw[idx + 3] = 255;
        } else {
          raw[idx] = 15;
          raw[idx + 1] = 23;
          raw[idx + 2] = 42;
          raw[idx + 3] = 255;
        }
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

for (const size of [16, 48, 128]) {
  writeFileSync(join(iconsDir, `icon${size}.png`), createIconPng(size));
}
console.log('[generate-icons] Created extension PNG icons (16, 48, 128).');
