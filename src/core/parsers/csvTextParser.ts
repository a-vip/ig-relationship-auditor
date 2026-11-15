import type { ExportParserPlugin, ParsedFileResult, ParserInputFile } from '../plugins/registry';
import type { AccountEntry } from '../types';
import { classifyPath } from './classifier';
import {
  buildProfileUrl,
  extractUsernameFromHref,
  mergeAccountEntries,
  normalizeUsername,
  parseTimestamp,
} from './normalize';

function splitCsvRow(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

export const csvTextExportParser: ExportParserPlugin = {
  id: 'instagram-csv-text-parser',
  name: 'CSV / Plaintext Handle List Parser',
  version: '1.0.0',
  description:
    'Parses CSV, TSV, and newline/comma-separated Instagram username or profile URL lists.',
  priority: 50,

  canParse(file: ParserInputFile): boolean {
    return /\.(csv|tsv|txt)$/i.test(file.name) || /\.(csv|tsv|txt)$/i.test(file.path);
  },

  parse(file: ParserInputFile): ParsedFileResult {
    const pathCategory = classifyPath(file.path);
    if (pathCategory === 'ignored') {
      return { category: 'ignored', entries: [], format: 'csv' };
    }

    const lines = file.content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));

    if (lines.length === 0) {
      return {
        category: pathCategory === 'unknown' ? 'unknown' : pathCategory,
        entries: [],
        format: file.name.toLowerCase().endsWith('.txt') ? 'txt' : 'csv',
      };
    }

    const first = lines[0];
    const delimiter = first.includes('\t') ? '\t' : first.includes(',') ? ',' : '';
    const entries: AccountEntry[] = [];

    if (delimiter) {
      const firstCells = splitCsvRow(first, delimiter).map((c) => c.toLowerCase());
      const userCol = firstCells.findIndex((c) => /^(username|handle|account|user)$/.test(c));
      const urlCol = firstCells.findIndex((c) => /^(url|href|profile_url|link)$/.test(c));
      const dateCol = firstCells.findIndex((c) => /^(timestamp|date|followed_at|created_at)$/.test(c));
      const hasHeader = userCol >= 0 || urlCol >= 0 || dateCol >= 0;
      const startIdx = hasHeader ? 1 : 0;

      for (let i = startIdx; i < lines.length; i += 1) {
        const cols = splitCsvRow(lines[i], delimiter);
        const rawUser = userCol >= 0 ? cols[userCol] : cols[0];
        const rawUrl = urlCol >= 0 ? cols[urlCol] : cols.find((c) => c.includes('instagram.com'));
        const username = normalizeUsername(rawUser) || extractUsernameFromHref(rawUrl);
        if (!username) continue;
        const ts = dateCol >= 0 ? parseTimestamp(cols[dateCol]) : undefined;
        entries.push({
          username,
          profileUrl: buildProfileUrl(username),
          timestamp: ts,
          sourceFile: file.path,
        });
      }
    } else {
      for (const line of lines) {
        const username = extractUsernameFromHref(line) || normalizeUsername(line);
        if (!username) continue;
        entries.push({
          username,
          profileUrl: buildProfileUrl(username),
          sourceFile: file.path,
        });
      }
    }

    return {
      category: pathCategory === 'unknown' || pathCategory === 'personal_info' ? 'unknown' : pathCategory,
      entries: mergeAccountEntries([], entries),
      format: file.name.toLowerCase().endsWith('.txt') ? 'txt' : 'csv',
    };
  },
};
