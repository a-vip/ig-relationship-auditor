export type RelationshipCategory =
  | 'followers'
  | 'following'
  | 'pending_requests'
  | 'recent_requests'
  | 'recently_unfollowed'
  | 'close_friends'
  | 'favorites'
  | 'blocked'
  | 'restricted'
  | 'unknown';

export type ExportFormat = 'html' | 'json' | 'csv' | 'txt' | 'live-sync' | 'mixed';

export interface AccountEntry {
  username: string;
  displayName?: string;
  profileUrl: string;
  timestamp?: number;
  rawDate?: string;
  sourceFile?: string;
  userId?: string;
}

export interface IngestFileSummary {
  path: string;
  name: string;
  format: 'html' | 'json' | 'csv' | 'txt';
  category: RelationshipCategory | 'personal_info' | 'ignored';
  entriesExtracted: number;
  lastModified?: number;
  warnings?: string[];
}

export interface ExportSnapshot {
  id: string;
  label: string;
  createdAt: number;
  exportGeneratedAt?: number;
  ownerUsername?: string;
  sourceFormat: ExportFormat;
  sourceKind: 'export_zip' | 'export_folder' | 'export_files' | 'live_sync' | 'demo';
  filesScanned: IngestFileSummary[];
  skippedFilesCount: number;
  warnings: string[];
  datasets: Record<RelationshipCategory, AccountEntry[]>;
}

export type VerificationStatus =
  | 'unverified'
  | 'verifying'
  | 'confirmed_not_following_back'
  | 'verified_mutual'
  | 'actually_follows_back'
  | 'already_unfollowed'
  | 'new_non_follower'
  | 'deactivated_or_missing'
  | 'handle_changed'
  | 'rate_limited'
  | 'error';

export type TransportKind = 'extension' | 'companion' | 'devtools' | 'manual';

export interface LiveProbeResult {
  username: string;
  normalizedUsername: string;
  userId?: string;
  fullName?: string;
  isPrivate?: boolean;
  isVerified?: boolean;
  followerCount?: number;
  followingCount?: number;
  avatarUrl?: string;
  biography?: string;
  accountExists: boolean;
  youFollow?: boolean;
  followsYou?: boolean;
  resolvedUsername?: string;
  checkedAt: number;
  method: TransportKind;
  error?: string;
}

export interface LiveGraphPayload {
  source: 'extension' | 'companion' | 'devtools';
  ownerUsername?: string;
  ownerUserId?: string;
  capturedAt: number;
  followers: AccountEntry[];
  following: AccountEntry[];
  completeFollowers: boolean;
  completeFollowing: boolean;
  warnings?: string[];
}

export type UnfollowState = 'none' | 'queued' | 'in_progress' | 'unfollowed' | 'kept' | 'failed';

export interface AccountMetadata {
  username: string;
  whitelisted: boolean;
  whitelistReason?: string;
  tags: string[];
  note: string;
  unfollowState: UnfollowState;
  unfollowedAt?: number;
  updatedAt: number;
}

export interface UnfollowAuditEntry {
  id: string;
  username: string;
  timestamp: number;
  method: 'extension_api' | 'extension_dom' | 'companion_api' | 'companion_dom' | 'guided_manual';
  verifiedAfter?: boolean;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
  snapshotId?: string;
}

export interface EnrichedAccount {
  username: string;
  displayName?: string;
  profileUrl: string;
  userId?: string;
  isFollowing: boolean;
  isFollower: boolean;
  isMutual: boolean;
  isNotFollowingBack: boolean;
  isFan: boolean;
  isPendingRequest: boolean;
  isRecentRequest: boolean;
  isCloseFriend: boolean;
  isFavorite: boolean;
  isBlocked: boolean;
  isRestricted: boolean;
  isRecentlyUnfollowed: boolean;
  isFromLiveSyncOnly: boolean;
  followedAt?: number;
  followedBackAt?: number;
  pendingSince?: number;
  rawDate?: string;
  sourceFiles: string[];
  verificationStatus: VerificationStatus;
  liveProbe?: LiveProbeResult;
  whitelisted: boolean;
  whitelistReason?: string;
  protectedByRule?: string;
  tags: string[];
  note: string;
  unfollowState: UnfollowState;
  unfollowedAt?: number;
}

export interface SmartProtectionConfig {
  protectCloseFriends: boolean;
  protectFavorites: boolean;
  protectVerified: boolean;
  gracePeriodDays: number;
  excludedRegex: string;
  protectedTags: string[];
}

export interface SafetyConfig {
  minDelaySec: number;
  maxDelaySec: number;
  maxPerBatch: number;
  maxPer24Hours: number;
  verifyBeforeUnfollow: boolean;
  useDomFallback: boolean;
  pauseOnRateLimit: boolean;
}

export interface ReconciledSummary {
  confirmedNotFollowingBack: number;
  alreadyUnfollowed: number;
  nowFollowsBack: number;
  newNonFollowers: number;
  deactivatedOrMissing: number;
  handleChanged: number;
  unverified: number;
}

export interface SnapshotDiffResult {
  olderSnapshotId: string;
  newerSnapshotId: string;
  olderLabel: string;
  newerLabel: string;
  gainedFollowers: AccountEntry[];
  lostFollowers: AccountEntry[];
  newFollowings: AccountEntry[];
  removedFollowings: AccountEntry[];
}

export interface AnalyzerInsight {
  id: string;
  moduleId: string;
  severity: 'info' | 'warning' | 'action' | 'success';
  title: string;
  summary: string;
  metricValue?: string | number;
  filterSegment?: AccountSegment;
  accountsSample?: string[];
}

export type AccountSegment =
  | 'not_following_back'
  | 'confirmed_non_mutual'
  | 'stale_already_unfollowed'
  | 'mutuals'
  | 'fans'
  | 'pending_requests'
  | 'close_friends'
  | 'whitelisted'
  | 'unfollowed_log'
  | 'deactivated_missing'
  | 'all';

export type WorkspaceTabId =
  | 'overview'
  | 'accounts'
  | 'fact-check'
  | 'unfollow'
  | 'compare'
  | 'modules';
