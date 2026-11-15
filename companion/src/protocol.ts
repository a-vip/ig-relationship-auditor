import crypto from 'node:crypto';

export interface CompanionConfig {
  port: number;
  host: string;
  token: string;
  profileDir: string;
  headless: boolean;
  allowedOrigins: string[];
}

export interface LiveProbeResult {
  username: string;
  normalizedUsername: string;
  userId?: string;
  fullName?: string;
  isPrivate?: boolean;
  isVerified?: boolean;
  followerCount?: number;
  followingCount?: number;
  accountExists: boolean;
  youFollow?: boolean;
  followsYou?: boolean;
  resolvedUsername?: string;
  checkedAt: number;
  method: 'companion';
  error?: string;
}

export function generatePairingToken(): string {
  return crypto.randomBytes(18).toString('base64url');
}

export function isOriginAllowed(origin: string | undefined, extraAllowed: string[] = []): boolean {
  if (!origin) return true; // non-browser curl/CLI calls
  if (extraAllowed.includes(origin)) return true;
  try {
    const parsed = new URL(origin);
    if (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return true;
    }
    if (parsed.protocol === 'https:' && parsed.hostname === 'a-vip.github.io') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function verifyToken(expected: string, provided: string | undefined): boolean {
  if (!expected) return true;
  if (!provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase();
}
