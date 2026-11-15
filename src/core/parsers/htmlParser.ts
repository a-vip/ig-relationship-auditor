import type { ExportParserPlugin, ParsedFileResult, ParserInputFile } from '../plugins/registry';
import type { AccountEntry } from '../types';
import { classifyByHtmlHeading, classifyPath } from './classifier';
import {
  buildProfileUrl,
  decodeMetaMojibake,
  extractUsernameFromHref,
  mergeAccountEntries,
  normalizeUsername,
  parseTimestamp,
} from './normalize';

const DATE_LINE_RE =
  /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}(?:,?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?)?|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}(?:,?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?)?|\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?Z?)?/i;

function findRowContainer(anchor: Element): Element | null {
  let curr: Element | null = anchor.parentElement;
  let best: Element | null = null;
  let steps = 0;

  while (curr && steps < 6 && curr.tagName.toLowerCase() !== 'body') {
    const anchors = curr.querySelectorAll('a[href*="instagram.com"]');
    // Only consider containers representing a single user row/card
    if (anchors.length > 1) {
      break;
    }
    const cls = curr.className || '';
    if (
      curr.tagName.toLowerCase() === 'tr' ||
      curr.tagName.toLowerCase() === 'li' ||
      /\b(_a6-g|pam|row|profile-row|user-card)\b/.test(cls)
    ) {
      best = curr;
    } else if (!best && curr.textContent && curr.textContent.trim().length > (anchor.textContent?.trim().length ?? 0)) {
      best = curr;
    }
    curr = curr.parentElement;
    steps += 1;
  }
  return best;
}

function extractDateFromRow(row: Element | null, usernameText: string): { timestamp?: number; rawDate?: string } {
  if (!row) return {};

  const timeEl = row.querySelector('time');
  if (timeEl) {
    const dtAttr = timeEl.getAttribute('datetime') || timeEl.textContent || '';
    const ts = parseTimestamp(dtAttr);
    if (ts) return { timestamp: ts, rawDate: dtAttr.trim() };
  }

  const dedicatedDateEl = row.querySelector('._a6-o, .utc, .timestamp, .date');
  if (dedicatedDateEl?.textContent) {
    const raw = dedicatedDateEl.textContent.trim();
    const ts = parseTimestamp(raw);
    if (ts) return { timestamp: ts, rawDate: raw };
  }

  const rawText = decodeMetaMojibake(row.textContent || '').replace(usernameText, ' ');
  const match = rawText.match(DATE_LINE_RE);
  if (match) {
    const raw = match[0].trim();
    const ts = parseTimestamp(raw);
    if (ts) return { timestamp: ts, rawDate: raw };
  }

  return {};
}

function extractOwnerUsernameFromHtml(doc: Document): string | undefined {
  const rows = Array.from(doc.querySelectorAll('tr, div._a6-g, div.pam, li'));
  for (const row of rows) {
    const text = (row.textContent || '').trim();
    if (/^username\b/i.test(text) || /\busername\s*[:\n]/i.test(text)) {
      const cells = row.querySelectorAll('td, div');
      for (let i = 0; i < cells.length; i += 1) {
        const cellText = (cells[i].textContent || '').trim();
        if (/^username$/i.test(cellText) && cells[i + 1]?.textContent) {
          const norm = normalizeUsername(cells[i + 1].textContent);
          if (norm) return norm;
        }
      }
      const match = text.match(/username\s*[:\-]?\s*@?([a-z0-9._]{1,30})/i);
      if (match?.[1]) {
        const norm = normalizeUsername(match[1]);
        if (norm) return norm;
      }
    }
  }
  return undefined;
}

export const htmlExportParser: ExportParserPlugin = {
  id: 'instagram-html-parser',
  name: 'Instagram HTML Export Parser',
  version: '1.0.0',
  description:
    'Parses Meta Accounts Center & legacy Instagram HTML exports (followers_1.html, following.html, pending requests, close friends, etc.).',
  priority: 90,

  canParse(file: ParserInputFile): boolean {
    if (/\.html?$/i.test(file.name) || /\.html?$/i.test(file.path)) return true;
    const head = file.content.slice(0, 512).trim().toLowerCase();
    return head.startsWith('<!doctype html') || head.startsWith('<html');
  },

  parse(file: ParserInputFile): ParsedFileResult {
    const parser = new DOMParser();
    const doc = parser.parseFromString(file.content, 'text/html');

    let category = classifyPath(file.path);
    if (category === 'unknown') {
      const headingText = [
        doc.title,
        ...Array.from(doc.querySelectorAll('h1, h2, h3, header, title')).map((el) => el.textContent || ''),
      ].join(' ');
      category = classifyByHtmlHeading(headingText);
    }

    if (category === 'ignored') {
      return { category: 'ignored', entries: [], format: 'html' };
    }

    if (category === 'personal_info') {
      const ownerUsername = extractOwnerUsernameFromHtml(doc);
      return {
        category: 'personal_info',
        entries: [],
        ownerUsername,
        format: 'html',
      };
    }

    const anchors = Array.from(doc.querySelectorAll('a[href]'));
    const rawEntries: AccountEntry[] = [];

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') || '';
      const anchorText = decodeMetaMojibake(anchor.textContent || '').trim();
      const fromHref = extractUsernameFromHref(href);
      const fromText = normalizeUsername(anchorText);
      const username = fromHref || (href.includes('instagram.com') ? fromText : null);
      if (!username) continue;

      const row = findRowContainer(anchor);
      const { timestamp, rawDate } = extractDateFromRow(row, anchorText);

      // Avoid treating raw username as display name unless text clearly differs
      const displayName =
        anchorText && normalizeUsername(anchorText) !== username ? anchorText : undefined;

      rawEntries.push({
        username,
        displayName,
        profileUrl: buildProfileUrl(username),
        timestamp,
        rawDate,
        sourceFile: file.path,
      });
    }

    // Fallback: some non-link HTML exports list handles inside table cells or <h2>/<span> without <a>
    if (rawEntries.length === 0) {
      const warnings = [
        `No Instagram profile hyperlinks found in ${file.name}. Checked anchor tags; attempting fallback handle extraction.`,
      ];
      const candidates = Array.from(doc.querySelectorAll('h2, td:first-child, li'));
      for (const el of candidates) {
        const text = (el.textContent || '').trim();
        if (text.startsWith('@') || /^[a-z0-9._]{2,30}$/i.test(text)) {
          const username = normalizeUsername(text);
          if (username) {
            rawEntries.push({
              username,
              profileUrl: buildProfileUrl(username),
              sourceFile: file.path,
            });
          }
        }
      }
      return {
        category: category === 'unknown' ? 'unknown' : category,
        entries: mergeAccountEntries([], rawEntries),
        format: 'html',
        warnings,
      };
    }

    return {
      category: category === 'unknown' ? 'unknown' : category,
      entries: mergeAccountEntries([], rawEntries),
      format: 'html',
    };
  },
};
