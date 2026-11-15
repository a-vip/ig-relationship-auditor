import type { ExportParserPlugin, ParsedFileResult, ParserInputFile } from '../plugins/registry';
import type { AccountEntry, RelationshipCategory } from '../types';
import { classifyByJsonRootKey, classifyPath } from './classifier';
import {
  buildProfileUrl,
  decodeMetaMojibake,
  extractUsernameFromHref,
  mergeAccountEntries,
  normalizeUsername,
  parseTimestamp,
} from './normalize';

interface RawMetaStringData {
  href?: string;
  value?: string;
  timestamp?: number | string;
}

interface RawMetaItem {
  title?: string;
  username?: string;
  handle?: string;
  href?: string;
  url?: string;
  profileUrl?: string;
  timestamp?: number | string;
  userId?: string;
  id?: string;
  fullName?: string;
  displayName?: string;
  string_list_data?: RawMetaStringData[];
}

function parseMetaItemsArray(items: unknown[], sourceFile: string): AccountEntry[] {
  const entries: AccountEntry[] = [];

  for (const raw of items) {
    if (typeof raw === 'string') {
      const username = extractUsernameFromHref(raw) || normalizeUsername(raw);
      if (username) {
        entries.push({
          username,
          profileUrl: buildProfileUrl(username),
          sourceFile,
        });
      }
      continue;
    }

    if (!raw || typeof raw !== 'object') continue;
    const item = raw as RawMetaItem;

    if (Array.isArray(item.string_list_data) && item.string_list_data.length > 0) {
      for (const sld of item.string_list_data) {
        const username =
          normalizeUsername(sld.value) ||
          normalizeUsername(item.title) ||
          extractUsernameFromHref(sld.href);
        if (!username) continue;
        const ts = parseTimestamp(sld.timestamp ?? item.timestamp);
        entries.push({
          username,
          displayName: item.fullName ? decodeMetaMojibake(item.fullName) : undefined,
          profileUrl: buildProfileUrl(username),
          timestamp: ts,
          sourceFile,
        });
      }
      continue;
    }

    const username =
      normalizeUsername(item.username) ||
      normalizeUsername(item.handle) ||
      normalizeUsername(item.title) ||
      extractUsernameFromHref(item.href || item.url || item.profileUrl);

    if (!username) continue;
    entries.push({
      username,
      displayName: item.fullName || item.displayName ? decodeMetaMojibake(String(item.fullName || item.displayName)) : undefined,
      profileUrl: buildProfileUrl(username),
      timestamp: parseTimestamp(item.timestamp),
      userId: item.userId || item.id ? String(item.userId || item.id) : undefined,
      sourceFile,
    });
  }

  return mergeAccountEntries([], entries);
}

function extractOwnerFromPersonalInfo(parsed: Record<string, unknown>): string | undefined {
  const profileUser = parsed.profile_user;
  if (Array.isArray(profileUser) && profileUser[0] && typeof profileUser[0] === 'object') {
    const stringMap = (profileUser[0] as Record<string, unknown>).string_map_data as
      | Record<string, { value?: string }>
      | undefined;
    const username = stringMap?.Username?.value || stringMap?.username?.value;
    if (username) return normalizeUsername(username) ?? undefined;
  }
  if (typeof parsed.username === 'string') {
    return normalizeUsername(parsed.username) ?? undefined;
  }
  return undefined;
}

export const jsonExportParser: ExportParserPlugin = {
  id: 'instagram-json-parser',
  name: 'Instagram JSON & Live-Sync Parser',
  version: '1.0.0',
  description:
    'Parses Meta Instagram JSON exports (arrays, relationships_* wrappers, title-only following.json, legacy connections.json, and live-sync JSON).',
  priority: 100,

  canParse(file: ParserInputFile): boolean {
    if (/\.json$/i.test(file.name) || /\.json$/i.test(file.path)) return true;
    const trimmed = file.content.trim();
    return (trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length > 2;
  },

  parse(file: ParserInputFile): ParsedFileResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.content);
    } catch (err) {
      return {
        category: 'ignored',
        entries: [],
        format: 'json',
        warnings: [
          `Failed to parse JSON in ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
        ],
      };
    }

    const pathCategory = classifyPath(file.path);
    if (pathCategory === 'ignored') {
      return { category: 'ignored', entries: [], format: 'json' };
    }

    // Case 1: Top-level array (e.g. followers_1.json or DevTools username array)
    if (Array.isArray(parsed)) {
      const entries = parseMetaItemsArray(parsed, file.path);
      return {
        category: pathCategory === 'unknown' ? 'unknown' : pathCategory,
        entries,
        format: 'json',
      };
    }

    if (!parsed || typeof parsed !== 'object') {
      return { category: 'ignored', entries: [], format: 'json' };
    }

    const obj = parsed as Record<string, unknown>;

    // Case 2: Combined Live-Sync or Legacy connections.json object containing followers & following arrays/maps
    const extraDatasets: Partial<Record<RelationshipCategory, AccountEntry[]>> = {};
    let primaryCategory: RelationshipCategory | 'personal_info' | 'ignored' =
      pathCategory === 'unknown' ? 'unknown' : pathCategory;
    let primaryEntries: AccountEntry[] = [];
    let ownerUsername: string | undefined =
      typeof obj.ownerUsername === 'string' ? normalizeUsername(obj.ownerUsername) ?? undefined : undefined;

    if (pathCategory === 'personal_info' || Array.isArray(obj.profile_user)) {
      return {
        category: 'personal_info',
        entries: [],
        ownerUsername: extractOwnerFromPersonalInfo(obj),
        format: 'json',
      };
    }

    for (const [key, val] of Object.entries(obj)) {
      const keyCategory = classifyByJsonRootKey(key);
      if (keyCategory === 'personal_info') {
        ownerUsername = ownerUsername || extractOwnerFromPersonalInfo({ [key]: val });
        continue;
      }

      if (Array.isArray(val)) {
        const parsedEntries = parseMetaItemsArray(val, file.path);
        const targetCategory: RelationshipCategory =
          keyCategory !== 'unknown'
            ? keyCategory
            : pathCategory !== 'unknown'
              ? (pathCategory as RelationshipCategory)
              : 'unknown';

        if (primaryEntries.length === 0) {
          primaryCategory = targetCategory;
          primaryEntries = parsedEntries;
        } else if (targetCategory !== 'unknown') {
          extraDatasets[targetCategory] = mergeAccountEntries(
            extraDatasets[targetCategory] ?? [],
            parsedEntries,
          );
        }
      } else if (val && typeof val === 'object' && !Array.isArray(val) && keyCategory !== 'unknown') {
        // Legacy dictionary format: { "followers": { "alice": "2020-05-01T..." } }
        const dictEntries: AccountEntry[] = [];
        for (const [handleKey, dateVal] of Object.entries(val as Record<string, unknown>)) {
          const username = normalizeUsername(handleKey);
          if (!username) continue;
          dictEntries.push({
            username,
            profileUrl: buildProfileUrl(username),
            timestamp: typeof dateVal === 'string' || typeof dateVal === 'number' ? parseTimestamp(dateVal) : undefined,
            sourceFile: file.path,
          });
        }
        if (primaryEntries.length === 0) {
          primaryCategory = keyCategory;
          primaryEntries = mergeAccountEntries([], dictEntries);
        } else {
          extraDatasets[keyCategory] = mergeAccountEntries(
            extraDatasets[keyCategory] ?? [],
            dictEntries,
          );
        }
      }
    }

    return {
      category: primaryCategory,
      entries: primaryEntries,
      extraDatasets: Object.keys(extraDatasets).length > 0 ? extraDatasets : undefined,
      ownerUsername,
      format: 'json',
    };
  },
};
