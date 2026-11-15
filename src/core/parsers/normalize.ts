const NON_PROFILE_SEGMENTS = new Set([
  'explore',
  'p',
  'reel',
  'reels',
  'stories',
  'direct',
  'accounts',
  'about',
  'developer',
  'developers',
  'legal',
  'privacy',
  'terms',
  'directory',
  'tv',
  'channel',
  'lite',
  'nametag',
  'oauth',
  'api',
  'web',
  'graphql',
  'static',
  'challenge',
  'session',
  'ar',
  'emails',
  'topics',
]);

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._]{0,28}[a-z0-9])?$|^[a-z0-9]$/;

/**
 * Meta JSON exports sometimes store UTF-8 bytes encoded as Latin-1 escape sequences
 * (e.g. "Ã©" instead of "é"). Safely decodes those sequences without corrupting valid Unicode.
 */
export function decodeMetaMojibake(input: string): string {
  if (!input || !/[\u00c2-\u00f4][\u0080-\u00bf]/.test(input)) {
    return input;
  }
  try {
    const bytes = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const code = input.charCodeAt(i);
      if (code > 0xff) {
        return input;
      }
      bytes[i] = code;
    }
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return decoded;
  } catch {
    return input;
  }
}

export function normalizeUsername(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let cleaned = decodeMetaMojibake(raw).trim().toLowerCase();
  if (cleaned.startsWith('@')) {
    cleaned = cleaned.slice(1);
  }
  cleaned = cleaned.replace(/[\s/]+$/g, '');
  if (!cleaned || cleaned.length > 30) return null;
  if (NON_PROFILE_SEGMENTS.has(cleaned)) return null;
  if (!USERNAME_RE.test(cleaned)) return null;
  return cleaned;
}

export function extractUsernameFromHref(href: string | undefined | null): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed) return null;

  try {
    const url = trimmed.startsWith('http')
      ? new URL(trimmed)
      : new URL(trimmed, 'https://www.instagram.com');
    const host = url.hostname.toLowerCase();
    if (
      host !== 'instagram.com' &&
      host !== 'www.instagram.com' &&
      host !== 'm.instagram.com' &&
      host !== 'l.instagram.com'
    ) {
      return null;
    }

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return null;

    if (segments[0] === '_u' && segments[1]) {
      return normalizeUsername(segments[1]);
    }
    if (NON_PROFILE_SEGMENTS.has(segments[0].toLowerCase())) {
      return null;
    }
    return normalizeUsername(segments[0]);
  } catch {
    return normalizeUsername(trimmed);
  }
}

export function buildProfileUrl(username: string): string {
  return `https://www.instagram.com/${encodeURIComponent(username)}/`;
}

/**
 * Normalizes Unix seconds, Unix ms, ISO strings, or localized Meta HTML dates
 * (e.g. "Jan 15, 2025, 4:32 PM", "15 Jan 2025 16:32", "Nov 02, 2024 8:15 am") to UTC epoch ms.
 */
export function parseTimestamp(input: string | number | undefined | null): number | undefined {
  if (input === undefined || input === null || input === '') return undefined;

  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) return undefined;
    // Heuristic: < 1e12 means Unix seconds
    return input < 1_000_000_000_000 ? Math.round(input * 1000) : Math.round(input);
  }

  const trimmed = decodeMetaMojibake(String(input)).trim();
  if (!trimmed) return undefined;

  if (/^\d{9,13}$/.test(trimmed)) {
    const num = Number(trimmed);
    return num < 1_000_000_000_000 ? num * 1000 : num;
  }

  // Strip common trailing timezone labels that can confuse Date.parse in some engines
  const normalizedDateStr = trimmed
    .replace(/\u202f/g, ' ')
    .replace(/\s+(UTC|GMT)\s*$/i, ' GMT')
    .replace(/,\s+(\d{1,2}:\d{2})/, ' $1');

  const parsed = Date.parse(normalizedDateStr);
  if (!Number.isNaN(parsed) && parsed > 946_684_800_000) {
    return parsed;
  }

  const fallback = Date.parse(trimmed);
  if (!Number.isNaN(fallback) && fallback > 946_684_800_000) {
    return fallback;
  }

  return undefined;
}

export function mergeAccountEntries(
  existing: Array<{
    username: string;
    displayName?: string;
    profileUrl: string;
    timestamp?: number;
    rawDate?: string;
    sourceFile?: string;
    userId?: string;
  }>,
  incoming: Array<{
    username: string;
    displayName?: string;
    profileUrl: string;
    timestamp?: number;
    rawDate?: string;
    sourceFile?: string;
    userId?: string;
  }>,
) {
  const map = new Map<string, (typeof existing)[number]>();
  for (const item of [...existing, ...incoming]) {
    const norm = normalizeUsername(item.username);
    if (!norm) continue;
    const prev = map.get(norm);
    if (!prev) {
      map.set(norm, {
        ...item,
        username: norm,
        profileUrl: item.profileUrl || buildProfileUrl(norm),
      });
    } else {
      map.set(norm, {
        username: norm,
        displayName: prev.displayName || item.displayName,
        profileUrl: prev.profileUrl || item.profileUrl || buildProfileUrl(norm),
        timestamp:
          prev.timestamp && item.timestamp
            ? Math.min(prev.timestamp, item.timestamp)
            : prev.timestamp ?? item.timestamp,
        rawDate: prev.rawDate || item.rawDate,
        sourceFile: prev.sourceFile || item.sourceFile,
        userId: prev.userId || item.userId,
      });
    }
  }
  return Array.from(map.values());
}
