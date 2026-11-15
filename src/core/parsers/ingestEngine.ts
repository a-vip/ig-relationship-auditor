import { defaultPluginRegistry, type ParserInputFile, type PluginRegistry } from '../plugins/registry';
import type {
  AccountEntry,
  ExportFormat,
  ExportSnapshot,
  IngestFileSummary,
  RelationshipCategory,
} from '../types';
import { classifyPath } from './classifier';
import { csvTextExportParser } from './csvTextParser';
import { htmlExportParser } from './htmlParser';
import { jsonExportParser } from './jsonParser';
import { mergeAccountEntries } from './normalize';
import { extractZipEntries } from './zipIngest';

let builtinRegistered = false;

export function ensureBuiltinParsersRegistered(registry: PluginRegistry = defaultPluginRegistry): void {
  if (builtinRegistered && registry === defaultPluginRegistry) return;
  registry.registerParser(jsonExportParser);
  registry.registerParser(htmlExportParser);
  registry.registerParser(csvTextExportParser);
  if (registry === defaultPluginRegistry) {
    builtinRegistered = true;
  }
}

export function createEmptyDatasets(): Record<RelationshipCategory, AccountEntry[]> {
  return {
    followers: [],
    following: [],
    pending_requests: [],
    recent_requests: [],
    recently_unfollowed: [],
    close_friends: [],
    favorites: [],
    blocked: [],
    restricted: [],
    unknown: [],
  };
}

function createSnapshotId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `snap_${crypto.randomUUID()}`;
  }
  return `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function readTextFile(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }
  return new Response(file).text();
}

export interface IngestOptions {
  label?: string;
  sourceKind?: ExportSnapshot['sourceKind'];
  registry?: PluginRegistry;
  onProgress?: (msg: string) => void;
}

export async function ingestRawFiles(
  inputs: ParserInputFile[],
  options: IngestOptions = {},
): Promise<ExportSnapshot> {
  const registry = options.registry ?? defaultPluginRegistry;
  ensureBuiltinParsersRegistered(registry);

  const datasets = createEmptyDatasets();
  const filesScanned: IngestFileSummary[] = [];
  const warnings: string[] = [];
  let skippedFilesCount = 0;
  let ownerUsername: string | undefined;
  const formatsSeen = new Set<'html' | 'json' | 'csv' | 'txt'>();
  let maxTimestamp = 0;
  let minTimestamp = Number.POSITIVE_INFINITY;
  let maxLastModified = 0;

  for (const input of inputs) {
    if (input.lastModified && input.lastModified > maxLastModified) {
      maxLastModified = input.lastModified;
    }

    const preCategory = classifyPath(input.path);
    if (preCategory === 'ignored') {
      skippedFilesCount += 1;
      continue;
    }

    const parser = registry.findParser(input);
    if (!parser) {
      skippedFilesCount += 1;
      continue;
    }

    const parsed = parser.parse(input);
    if (parsed.warnings) {
      warnings.push(...parsed.warnings);
    }

    if (parsed.ownerUsername && !ownerUsername) {
      ownerUsername = parsed.ownerUsername;
    }

    if (parsed.category === 'ignored') {
      skippedFilesCount += 1;
      continue;
    }

    formatsSeen.add(parsed.format);

    let extractedCount = 0;

    if (parsed.category !== 'personal_info') {
      const cat = parsed.category;
      datasets[cat] = mergeAccountEntries(datasets[cat], parsed.entries);
      extractedCount += parsed.entries.length;
      for (const e of parsed.entries) {
        if (e.timestamp) {
          if (e.timestamp > maxTimestamp) maxTimestamp = e.timestamp;
          if (e.timestamp < minTimestamp) minTimestamp = e.timestamp;
        }
      }
    }

    if (parsed.extraDatasets) {
      for (const [extraCat, extraList] of Object.entries(parsed.extraDatasets) as Array<
        [RelationshipCategory, AccountEntry[]]
      >) {
        if (!extraList?.length) continue;
        datasets[extraCat] = mergeAccountEntries(datasets[extraCat], extraList);
        extractedCount += extraList.length;
        for (const e of extraList) {
          if (e.timestamp) {
            if (e.timestamp > maxTimestamp) maxTimestamp = e.timestamp;
            if (e.timestamp < minTimestamp) minTimestamp = e.timestamp;
          }
        }
      }
    }

    filesScanned.push({
      path: input.path,
      name: input.name,
      format: parsed.format,
      category: parsed.category,
      entriesExtracted: extractedCount,
      lastModified: input.lastModified,
      warnings: parsed.warnings,
    });
  }

  let sourceFormat: ExportFormat = 'html';
  if (formatsSeen.size > 1) {
    sourceFormat = 'mixed';
  } else if (formatsSeen.size === 1) {
    sourceFormat = Array.from(formatsSeen)[0];
  }

  if (datasets.following.length === 0 && datasets.followers.length === 0) {
    warnings.push(
      'No followers or following entries were detected. Check that you uploaded your Meta Instagram data download folder/ZIP or followers_1 + following files.',
    );
  } else {
    if (datasets.following.length === 0) {
      warnings.push(
        'No "following" file was detected in this upload — add following.html or following.json to calculate who is not following you back.',
      );
    }
    if (datasets.followers.length === 0) {
      warnings.push(
        'No "followers" file was detected in this upload — add followers_1.html or followers_1.json to distinguish mutuals from non-followers.',
      );
    }
  }

  const exportGeneratedAt =
    maxTimestamp > 0 ? maxTimestamp : maxLastModified > 0 ? maxLastModified : Date.now();

  const defaultLabel = ownerUsername
    ? `@${ownerUsername} (${sourceFormat.toUpperCase()})`
    : `Instagram Export (${sourceFormat.toUpperCase()})`;

  return {
    id: createSnapshotId(),
    label: options.label || defaultLabel,
    createdAt: Date.now(),
    exportGeneratedAt,
    ownerUsername,
    sourceFormat,
    sourceKind: options.sourceKind || 'export_files',
    filesScanned,
    skippedFilesCount,
    warnings,
    datasets,
  };
}

export async function ingestUploadedFiles(
  fileList: File[] | FileList,
  options: IngestOptions = {},
): Promise<ExportSnapshot> {
  const files = Array.from(fileList);
  const rawInputs: ParserInputFile[] = [];
  let totalSkipped = 0;
  let inferredKind: ExportSnapshot['sourceKind'] = options.sourceKind || 'export_files';

  for (const file of files) {
    const relPath =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;

    if (/\.zip$/i.test(file.name)) {
      inferredKind = options.sourceKind || 'export_zip';
      const zipRes = await extractZipEntries(file, options.onProgress);
      rawInputs.push(...zipRes.files);
      totalSkipped += zipRes.skippedCount;
      continue;
    }

    if (relPath.includes('/')) {
      inferredKind = options.sourceKind || 'export_folder';
    }

    if (classifyPath(relPath) === 'ignored') {
      totalSkipped += 1;
      continue;
    }

    if (!/\.(html?|json|csv|tsv|txt)$/i.test(file.name)) {
      totalSkipped += 1;
      continue;
    }

    options.onProgress?.(`Reading ${relPath}...`);
    const content = await readTextFile(file);
    rawInputs.push({
      name: file.name,
      path: relPath,
      content,
      lastModified: file.lastModified,
    });
  }

  const snapshot = await ingestRawFiles(rawInputs, {
    ...options,
    sourceKind: inferredKind,
  });

  snapshot.skippedFilesCount += totalSkipped;
  return snapshot;
}

/**
 * Recursively collects files dropped via DataTransferItem / FileSystemDirectoryEntry
 * (so dragging an extracted Instagram export folder works smoothly in Chrome/Edge/Firefox).
 */
export async function collectDroppedEntries(dataTransfer: DataTransfer): Promise<File[]> {
  const files: File[] = [];

  async function walkEntry(entry: FileSystemEntry, prefix = ''): Promise<void> {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject));
      const relPath = prefix ? `${prefix}/${file.name}` : file.name;
      Object.defineProperty(file, 'webkitRelativePath', {
        value: relPath,
        configurable: true,
      });
      files.push(file);
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const reader = dirEntry.createReader();
      const readBatch = (): Promise<FileSystemEntry[]> =>
        new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      let batch = await readBatch();
      while (batch.length > 0) {
        for (const child of batch) {
          await walkEntry(child, prefix ? `${prefix}/${entry.name}` : entry.name);
        }
        batch = await readBatch();
      }
    }
  }

  const items = Array.from(dataTransfer.items || []);
  const entries = items
    .map((item) => item.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => Boolean(e));

  if (entries.length > 0) {
    for (const entry of entries) {
      await walkEntry(entry);
    }
    return files;
  }

  return Array.from(dataTransfer.files || []);
}
