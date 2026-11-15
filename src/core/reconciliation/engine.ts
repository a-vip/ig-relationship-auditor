import { buildProfileUrl, normalizeUsername } from '../parsers/normalize';
import type {
  AccountEntry,
  AccountMetadata,
  AccountSegment,
  EnrichedAccount,
  ExportSnapshot,
  LiveGraphPayload,
  LiveProbeResult,
  ReconciledSummary,
  SmartProtectionConfig,
  SnapshotDiffResult,
  VerificationStatus,
} from '../types';
import { evaluateSmartProtection } from './safetyRules';

export interface BuildEnrichedOptions {
  snapshot: ExportSnapshot;
  liveGraph?: LiveGraphPayload | null;
  liveProbes?: Record<string, LiveProbeResult>;
  metadataMap?: Record<string, AccountMetadata>;
  protectionConfig: SmartProtectionConfig;
  nowMs?: number;
}

function toMap(entries: AccountEntry[]): Map<string, AccountEntry> {
  const map = new Map<string, AccountEntry>();
  for (const e of entries) {
    map.set(e.username, e);
  }
  return map;
}

function deriveVerificationStatus(params: {
  username: string;
  inExportFollowing: boolean;
  inExportFollowers: boolean;
  liveFollowingMap?: Map<string, AccountEntry>;
  liveFollowersMap?: Map<string, AccountEntry>;
  liveGraph?: LiveGraphPayload | null;
  probe?: LiveProbeResult;
}): VerificationStatus {
  const {
    username,
    inExportFollowing,
    inExportFollowers,
    liveFollowingMap,
    liveFollowersMap,
    liveGraph,
    probe,
  } = params;

  // 1. Targeted live probe takes precedence for that specific account when fresh
  if (probe) {
    if (probe.error === 'rate_limited') return 'rate_limited';
    if (probe.error) return 'error';
    if (!probe.accountExists) return 'deactivated_or_missing';
    if (probe.resolvedUsername && normalizeUsername(probe.resolvedUsername) !== username) {
      return 'handle_changed';
    }
    if (probe.youFollow === false && inExportFollowing) {
      return 'already_unfollowed';
    }
    if (probe.youFollow === true && probe.followsYou === true) {
      return inExportFollowers ? 'verified_mutual' : 'actually_follows_back';
    }
    if (probe.youFollow === true && probe.followsYou === false) {
      return 'confirmed_not_following_back';
    }
  }

  // 2. Full or partial live graph reconciliation
  if (liveGraph && liveFollowingMap && liveFollowersMap) {
    const liveFollows = liveFollowingMap.has(username);
    const liveFollowedBy = liveFollowersMap.has(username);

    if (inExportFollowing && !liveFollows && liveGraph.completeFollowing) {
      // Also absent from live followers? Still "already_unfollowed" because user isn't following them anymore
      return 'already_unfollowed';
    }
    if (liveFollows && liveFollowedBy) {
      return inExportFollowers ? 'verified_mutual' : 'actually_follows_back';
    }
    if (liveFollows && !liveFollowedBy && liveGraph.completeFollowers) {
      return inExportFollowing ? 'confirmed_not_following_back' : 'new_non_follower';
    }
  }

  return 'unverified';
}

export function buildEnrichedAccounts(options: BuildEnrichedOptions): EnrichedAccount[] {
  const {
    snapshot,
    liveGraph,
    liveProbes = {},
    metadataMap = {},
    protectionConfig,
    nowMs = Date.now(),
  } = options;

  const expFollowers = toMap(snapshot.datasets.followers);
  const expFollowing = toMap(snapshot.datasets.following);
  const expPending = toMap(snapshot.datasets.pending_requests);
  const expRecentReq = toMap(snapshot.datasets.recent_requests);
  const expRecentlyUnfollowed = toMap(snapshot.datasets.recently_unfollowed);
  const expCloseFriends = toMap(snapshot.datasets.close_friends);
  const expFavorites = toMap(snapshot.datasets.favorites);
  const expBlocked = toMap(snapshot.datasets.blocked);
  const expRestricted = toMap(snapshot.datasets.restricted);

  const liveFollowers = liveGraph ? toMap(liveGraph.followers) : undefined;
  const liveFollowing = liveGraph ? toMap(liveGraph.following) : undefined;

  const allUsernames = new Set<string>([
    ...expFollowers.keys(),
    ...expFollowing.keys(),
    ...expPending.keys(),
    ...expRecentReq.keys(),
    ...expRecentlyUnfollowed.keys(),
    ...expCloseFriends.keys(),
    ...expFavorites.keys(),
    ...expBlocked.keys(),
    ...expRestricted.keys(),
    ...(liveFollowers ? liveFollowers.keys() : []),
    ...(liveFollowing ? liveFollowing.keys() : []),
  ]);

  const result: EnrichedAccount[] = [];

  for (const username of allUsernames) {
    const fEntry = expFollowers.get(username);
    const ingEntry = expFollowing.get(username);
    const pendingEntry = expPending.get(username);
    const liveF = liveFollowers?.get(username);
    const liveIng = liveFollowing?.get(username);
    const probe = liveProbes[username];
    const meta = metadataMap[username];

    const inExpFollowing = Boolean(ingEntry);
    const inExpFollowers = Boolean(fEntry);
    const isFromLiveSyncOnly = !inExpFollowing && !inExpFollowers && !pendingEntry && Boolean(liveF || liveIng);

    // Effective relationship state uses live override if verified/synced, otherwise export state
    const isFollowing = liveFollowing
      ? liveFollowing.has(username) || (!liveGraph?.completeFollowing && inExpFollowing)
      : probe?.youFollow !== undefined
        ? probe.youFollow
        : inExpFollowing;

    const isFollower = liveFollowers
      ? liveFollowers.has(username) || (!liveGraph?.completeFollowers && inExpFollowers)
      : probe?.followsYou !== undefined
        ? probe.followsYou
        : inExpFollowers;

    const verificationStatus = deriveVerificationStatus({
      username,
      inExportFollowing: inExpFollowing,
      inExportFollowers: inExpFollowers,
      liveFollowingMap: liveFollowing,
      liveFollowersMap: liveFollowers,
      liveGraph,
      probe,
    });

    const sourceFiles = Array.from(
      new Set(
        [
          ingEntry?.sourceFile,
          fEntry?.sourceFile,
          pendingEntry?.sourceFile,
          expCloseFriends.get(username)?.sourceFile,
        ].filter((s): s is string => Boolean(s)),
      ),
    );

    const isCloseFriend = expCloseFriends.has(username);
    const isFavorite = expFavorites.has(username);
    const followedAt = ingEntry?.timestamp ?? liveIng?.timestamp;

    const draft: EnrichedAccount = {
      username,
      displayName:
        probe?.fullName ||
        ingEntry?.displayName ||
        fEntry?.displayName ||
        liveIng?.displayName ||
        liveF?.displayName,
      profileUrl: buildProfileUrl(username),
      userId: probe?.userId || ingEntry?.userId || fEntry?.userId || liveIng?.userId || liveF?.userId,
      isFollowing,
      isFollower,
      isMutual: isFollowing && isFollower,
      isNotFollowingBack: isFollowing && !isFollower,
      isFan: isFollower && !isFollowing,
      isPendingRequest: expPending.has(username),
      isRecentRequest: expRecentReq.has(username),
      isCloseFriend,
      isFavorite,
      isBlocked: expBlocked.has(username),
      isRestricted: expRestricted.has(username),
      isRecentlyUnfollowed: expRecentlyUnfollowed.has(username),
      isFromLiveSyncOnly,
      followedAt,
      followedBackAt: fEntry?.timestamp ?? liveF?.timestamp,
      pendingSince: pendingEntry?.timestamp,
      rawDate: ingEntry?.rawDate || fEntry?.rawDate,
      sourceFiles,
      verificationStatus,
      liveProbe: probe,
      whitelisted: meta?.whitelisted ?? false,
      whitelistReason: meta?.whitelistReason,
      tags: meta?.tags ?? [],
      note: meta?.note ?? '',
      unfollowState: meta?.unfollowState ?? 'none',
      unfollowedAt: meta?.unfollowedAt,
    };

    const ruleReason = evaluateSmartProtection(draft, protectionConfig, nowMs);
    if (ruleReason && !draft.whitelisted) {
      draft.protectedByRule = ruleReason;
    }

    result.push(draft);
  }

  return result;
}

export function summarizeReconciliation(accounts: EnrichedAccount[]): ReconciledSummary {
  const summary: ReconciledSummary = {
    confirmedNotFollowingBack: 0,
    alreadyUnfollowed: 0,
    nowFollowsBack: 0,
    newNonFollowers: 0,
    deactivatedOrMissing: 0,
    handleChanged: 0,
    unverified: 0,
  };

  for (const acc of accounts) {
    switch (acc.verificationStatus) {
      case 'confirmed_not_following_back':
        summary.confirmedNotFollowingBack += 1;
        break;
      case 'already_unfollowed':
        summary.alreadyUnfollowed += 1;
        break;
      case 'actually_follows_back':
        summary.nowFollowsBack += 1;
        break;
      case 'new_non_follower':
        summary.newNonFollowers += 1;
        break;
      case 'deactivated_or_missing':
        summary.deactivatedOrMissing += 1;
        break;
      case 'handle_changed':
        summary.handleChanged += 1;
        break;
      case 'unverified':
        if (acc.isNotFollowingBack) summary.unverified += 1;
        break;
      default:
        break;
    }
  }

  return summary;
}

export function filterAccountsBySegment(
  accounts: EnrichedAccount[],
  segment: AccountSegment,
): EnrichedAccount[] {
  switch (segment) {
    case 'not_following_back':
      return accounts.filter(
        (a) => a.isNotFollowingBack && a.unfollowState !== 'unfollowed',
      );
    case 'confirmed_non_mutual':
      return accounts.filter(
        (a) =>
          (a.verificationStatus === 'confirmed_not_following_back' ||
            a.verificationStatus === 'new_non_follower') &&
          a.unfollowState !== 'unfollowed',
      );
    case 'stale_already_unfollowed':
      return accounts.filter((a) => a.verificationStatus === 'already_unfollowed');
    case 'mutuals':
      return accounts.filter((a) => a.isMutual);
    case 'fans':
      return accounts.filter((a) => a.isFan);
    case 'pending_requests':
      return accounts.filter((a) => a.isPendingRequest);
    case 'close_friends':
      return accounts.filter((a) => a.isCloseFriend);
    case 'whitelisted':
      return accounts.filter((a) => a.whitelisted || Boolean(a.protectedByRule));
    case 'unfollowed_log':
      return accounts.filter(
        (a) => a.unfollowState === 'unfollowed' || a.isRecentlyUnfollowed,
      );
    case 'deactivated_missing':
      return accounts.filter((a) => a.verificationStatus === 'deactivated_or_missing');
    case 'all':
    default:
      return accounts;
  }
}

export function diffSnapshots(
  older: ExportSnapshot,
  newer: ExportSnapshot,
): SnapshotDiffResult {
  const oldFollowers = new Map(older.datasets.followers.map((e) => [e.username, e]));
  const newFollowers = new Map(newer.datasets.followers.map((e) => [e.username, e]));
  const oldFollowing = new Map(older.datasets.following.map((e) => [e.username, e]));
  const newFollowing = new Map(newer.datasets.following.map((e) => [e.username, e]));

  const gainedFollowers = newer.datasets.followers.filter((e) => !oldFollowers.has(e.username));
  const lostFollowers = older.datasets.followers.filter((e) => !newFollowers.has(e.username));
  const newFollowings = newer.datasets.following.filter((e) => !oldFollowing.has(e.username));
  const removedFollowings = older.datasets.following.filter((e) => !newFollowing.has(e.username));

  return {
    olderSnapshotId: older.id,
    newerSnapshotId: newer.id,
    olderLabel: older.label,
    newerLabel: newer.label,
    gainedFollowers,
    lostFollowers,
    newFollowings,
    removedFollowings,
  };
}
