import { describe, expect, it } from 'vitest';
import {
  generatePairingToken,
  isOriginAllowed,
  normalizeHandle,
  verifyToken,
} from '../src/protocol.js';

describe('companion protocol security & helpers', () => {
  it('allows GitHub Pages and localhost origins while rejecting arbitrary origins', () => {
    expect(isOriginAllowed('https://a-vip.github.io')).toBe(true);
    expect(isOriginAllowed('http://localhost:5173')).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:4173')).toBe(true);
    expect(isOriginAllowed('https://evil.example.com')).toBe(false);
    expect(isOriginAllowed('https://github.io.evil.com')).toBe(false);
  });

  it('validates pairing tokens using constant-time comparison', () => {
    const token = generatePairingToken();
    expect(token.length).toBeGreaterThanOrEqual(20);
    expect(verifyToken(token, token)).toBe(true);
    expect(verifyToken(token, `${token}x`)).toBe(false);
    expect(verifyToken(token, undefined)).toBe(false);
  });

  it('normalizes handles cleanly', () => {
    expect(normalizeHandle('  @Alice.Dev ')).toBe('alice.dev');
  });
});
