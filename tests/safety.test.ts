import { describe, expect, it } from 'vitest';
import {
  computeHumanDelayMs,
  computeRemainingDailyQuota,
  countActionsLast24Hours,
  DEFAULT_SAFETY_CONFIG,
  isAccountEligibleForQueue,
} from '../src/core/reconciliation/safetyRules';
import { exportAccountsToCsv } from '../src/core/storage/db';
import type { EnrichedAccount, UnfollowAuditEntry } from '../src/core/types';

function makeAccount(overrides: Partial<EnrichedAccount>): EnrichedAccount {
  return {
    username: 'user_a',
    profileUrl: 'https://www.instagram.com/user_a/',
    isFollowing: true,
    isFollower: false,
    isMutual: false,
    isNotFollowingBack: true,
    isFan: false,
    isPendingRequest: false,
    isRecentRequest: false,
    isCloseFriend: false,
    isFavorite: false,
    isBlocked: false,
    isRestricted: false,
    isRecentlyUnfollowed: false,
    isFromLiveSyncOnly: false,
    sourceFiles: ['following.html'],
    verificationStatus: 'unverified',
    whitelisted: false,
    tags: [],
    note: '',
    unfollowState: 'none',
    ...overrides,
  };
}

describe('safety guardrails & CSV export', () => {
  it('computes rolling 24h unfollow quota accurately', () => {
    const now = Date.now();
    const log: UnfollowAuditEntry[] = [
      { id: '1', username: 'a', timestamp: now - 60_000, method: 'guided_manual', status: 'success' },
      { id: '2', username: 'b', timestamp: now - 3_600_000, method: 'extension_api', status: 'success' },
      { id: '3', username: 'c', timestamp: now - 10_000, method: 'extension_api', status: 'failed' },
      { id: '4', username: 'd', timestamp: now - 30 * 3_600_000, method: 'guided_manual', status: 'success' },
    ];

    expect(countActionsLast24Hours(log, now)).toBe(2);
    expect(computeRemainingDailyQuota(log, { ...DEFAULT_SAFETY_CONFIG, maxPer24Hours: 5 }, now)).toBe(3);
  });

  it('keeps human delay within configured bounds', () => {
    const cfg = { ...DEFAULT_SAFETY_CONFIG, minDelaySec: 12, maxDelaySec: 20 };
    for (let i = 0; i < 20; i += 1) {
      const ms = computeHumanDelayMs(cfg);
      expect(ms).toBeGreaterThanOrEqual(12_000);
      expect(ms).toBeLessThanOrEqual(20_000);
    }
  });

  it('blocks protected, whitelisted, already-unfollowed, and newly-mutual accounts from the queue', () => {
    expect(isAccountEligibleForQueue(makeAccount({}))).toBe(true);
    expect(isAccountEligibleForQueue(makeAccount({ whitelisted: true }))).toBe(false);
    expect(isAccountEligibleForQueue(makeAccount({ protectedByRule: 'Close Friends list' }))).toBe(false);
    expect(isAccountEligibleForQueue(makeAccount({ verificationStatus: 'already_unfollowed' }))).toBe(false);
    expect(isAccountEligibleForQueue(makeAccount({ verificationStatus: 'actually_follows_back' }))).toBe(false);
  });

  it('escapes CSV notes/tags safely', () => {
    const csv = exportAccountsToCsv([
      makeAccount({ username: 'creator_x', note: 'Keep, "friend"', tags: ['vip', 'art'] }),
    ]);
    expect(csv).toContain('creator_x');
    expect(csv).toContain('"Keep, ""friend"""');
    expect(csv).toContain('vip; art');
  });
});
