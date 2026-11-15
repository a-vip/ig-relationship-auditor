import type {
  AccountMetadata,
  EnrichedAccount,
  SafetyConfig,
  SmartProtectionConfig,
  UnfollowAuditEntry,
} from '../types';

export const DEFAULT_PROTECTION_CONFIG: SmartProtectionConfig = {
  protectCloseFriends: true,
  protectFavorites: true,
  protectVerified: false,
  gracePeriodDays: 7,
  excludedRegex: '',
  protectedTags: ['vip', 'friend', 'keep', 'family'],
};

export const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  minDelaySec: 18,
  maxDelaySec: 36,
  maxPerBatch: 15,
  maxPer24Hours: 50,
  verifyBeforeUnfollow: true,
  useDomFallback: true,
  pauseOnRateLimit: true,
};

export function evaluateSmartProtection(
  account: Pick<
    EnrichedAccount,
    | 'username'
    | 'isCloseFriend'
    | 'isFavorite'
    | 'followedAt'
    | 'liveProbe'
    | 'tags'
    | 'whitelisted'
    | 'whitelistReason'
  >,
  config: SmartProtectionConfig,
  nowMs = Date.now(),
): string | undefined {
  if (account.whitelisted) {
    return account.whitelistReason || 'Manually whitelisted';
  }
  if (config.protectCloseFriends && account.isCloseFriend) {
    return 'Close Friends list';
  }
  if (config.protectFavorites && account.isFavorite) {
    return 'Favorited account';
  }
  if (config.protectVerified && account.liveProbe?.isVerified) {
    return 'Verified account';
  }
  if (config.gracePeriodDays > 0 && account.followedAt) {
    const ageDays = (nowMs - account.followedAt) / (1000 * 60 * 60 * 24);
    if (ageDays >= 0 && ageDays < config.gracePeriodDays) {
      return `Followed < ${config.gracePeriodDays}d ago`;
    }
  }
  if (config.protectedTags.length > 0 && account.tags.length > 0) {
    const lowerProtected = new Set(config.protectedTags.map((t) => t.toLowerCase()));
    const hit = account.tags.find((t) => lowerProtected.has(t.toLowerCase()));
    if (hit) return `Protected tag #${hit}`;
  }
  if (config.excludedRegex.trim()) {
    try {
      const re = new RegExp(config.excludedRegex.trim(), 'i');
      if (re.test(account.username)) {
        return 'Matches excluded regex';
      }
    } catch {
      // Ignore invalid user-entered regex until corrected in UI
    }
  }
  return undefined;
}

export function countActionsLast24Hours(
  auditLog: UnfollowAuditEntry[],
  nowMs = Date.now(),
): number {
  const cutoff = nowMs - 24 * 60 * 60 * 1000;
  return auditLog.filter(
    (entry) => entry.status === 'success' && entry.timestamp >= cutoff,
  ).length;
}

export function computeRemainingDailyQuota(
  auditLog: UnfollowAuditEntry[],
  safetyConfig: SafetyConfig,
  nowMs = Date.now(),
): number {
  const used = countActionsLast24Hours(auditLog, nowMs);
  return Math.max(0, safetyConfig.maxPer24Hours - used);
}

export function computeHumanDelayMs(safetyConfig: SafetyConfig): number {
  const minMs = Math.max(2000, Math.min(safetyConfig.minDelaySec, safetyConfig.maxDelaySec) * 1000);
  const maxMs = Math.max(minMs, Math.max(safetyConfig.minDelaySec, safetyConfig.maxDelaySec) * 1000);
  return Math.round(minMs + Math.random() * (maxMs - minMs));
}

export function isAccountEligibleForQueue(
  account: EnrichedAccount,
  metadataMap?: Record<string, AccountMetadata>,
): boolean {
  if (account.whitelisted || account.protectedByRule) return false;
  if (account.unfollowState === 'unfollowed' || account.unfollowState === 'kept') return false;
  if (account.verificationStatus === 'already_unfollowed') return false;
  if (account.verificationStatus === 'actually_follows_back') return false;
  const meta = metadataMap?.[account.username];
  if (meta?.whitelisted) return false;
  return account.isNotFollowingBack || account.verificationStatus === 'confirmed_not_following_back';
}
