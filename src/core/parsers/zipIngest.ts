import { strFromU8, unzip, Unzip, UnzipInflate } from 'fflate';
import type { ParserInputFile } from '../plugins/registry';
import { classifyPath } from './classifier';

const TEXT_EXT_RE = /\.(html?|json|csv|tsv|txt)$/i;
const MAX_SINGLE_TEXT_FILE_BYTES = 50 * 1024 * 1024; // 50 MB guard per text entry

function shouldExtractZipEntry(path: string, uncompressedSize?: number): boolean {
  if (!path || path.endsWith('/')) return false;
  if (path.includes('__MACOSX/')) return false;
  if (!TEXT_EXT_RE.test(path)) return false;
  if (uncompressedSize && uncompressedSize > MAX_SINGLE_TEXT_FILE_BYTES) return false;
  return classifyPath(path) !== 'ignored';
}

export interface ZipExtractionResult {
  files: ParserInputFile[];
  skippedCount: number;
}

async function readAllBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') {
    return new Uint8Array(await file.arrayBuffer());
  }
  return new Uint8Array(await new Response(file).arrayBuffer());
}

export async function extractZipEntries(
  file: File,
  onProgress?: (message: string) => void,
): Promise<ZipExtractionResult> {
  // For large archives (> 64 MB) with ReadableStream support, stream chunks to avoid holding the entire media ZIP in memory.
  if (file.size > 64 * 1024 * 1024 && typeof file.stream === 'function') {
    return extractZipStreaming(file, onProgress);
  }

  onProgress?.(`Unpacking ${file.name}...`);
  const bytes = await readAllBytes(file);

  let skippedCount = 0;
  return new Promise<ZipExtractionResult>((resolve, reject) => {
    unzip(
      bytes,
      {
        filter: (info) => {
          const keep = shouldExtractZipEntry(info.name, info.originalSize);
          if (!keep && !info.name.endsWith('/')) {
            skippedCount += 1;
          }
          return keep;
        },
      },
      (err, entries) => {
        if (err) {
          reject(err);
          return;
        }
        const files: ParserInputFile[] = [];
        for (const [entryPath, data] of Object.entries(entries)) {
          files.push({
            path: entryPath,
            name: entryPath.split('/').pop() || entryPath,
            content: strFromU8(data),
            lastModified: file.lastModified,
          });
        }
        resolve({ files, skippedCount });
      },
    );
  });
}

async function extractZipStreaming(
  file: File,
  onProgress?: (message: string) => void,
): Promise<ZipExtractionResult> {
  const files: ParserInputFile[] = [];
  let skippedCount = 0;

  const unzipper = new Unzip((streamFile) => {
    if (!shouldExtractZipEntry(streamFile.name, streamFile.originalSize)) {
      if (!streamFile.name.endsWith('/')) skippedCount += 1;
      return;
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let aborted = false;

    streamFile.ondata = (err, chunk, final) => {
      if (err || aborted) return;
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_SINGLE_TEXT_FILE_BYTES) {
        aborted = true;
        skippedCount += 1;
        return;
      }
      chunks.push(chunk);
      if (final) {
        const merged = new Uint8Array(totalBytes);
        let offset = 0;
        for (const part of chunks) {
          merged.set(part, offset);
          offset += part.byteLength;
        }
        files.push({
          path: streamFile.name,
          name: streamFile.name.split('/').pop() || streamFile.name,
          content: strFromU8(merged),
          lastModified: file.lastModified,
        });
      }
    };
    streamFile.start();
  });
  unzipper.register(UnzipInflate);

  const reader = file.stream().getReader();
  let bytesRead = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        unzipper.push(new Uint8Array(0), true);
        break;
      }
      if (value) {
        bytesRead += value.byteLength;
        if (file.size > 0) {
          const pct = Math.min(99, Math.round((bytesRead / file.size) * 100));
          onProgress?.(`Streaming ${file.name} (${pct}%)...`);
        }
        unzipper.push(value, false);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { files, skippedCount };
}
