import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const extDir = join(rootDir, 'extension');
const outPath = join(rootDir, 'public', 'downloads', 'ig-auditor-extension.zip');

function collectFiles(dir, baseDir) {
  const entries = {};
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      Object.assign(entries, collectFiles(full, baseDir));
    } else {
      const rel = relative(baseDir, full).replace(/\\/g, '/');
      entries[`ig-auditor-extension/${rel}`] = new Uint8Array(readFileSync(full));
    }
  }
  return entries;
}

if (!existsSync(extDir)) {
  console.warn('[bundle-extension] extension/ directory not found, skipping zip generation.');
  process.exit(0);
}

mkdirSync(dirname(outPath), { recursive: true });
const files = collectFiles(extDir, extDir);
const zipped = zipSync(files, { level: 6 });
writeFileSync(outPath, zipped);
console.log(`[bundle-extension] Packaged ${Object.keys(files).length} files -> ${outPath} (${zipped.byteLength} bytes)`);
