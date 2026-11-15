import type { AnalyzerContext, AnalyzerModule, PluginRegistry } from './registry';
import { defaultPluginRegistry } from './registry';
import type { AnalyzerInsight } from '../types';

export const exportFreshnessAnalyzer: AnalyzerModule = {
  id: 'analyzer-export-freshness',
  name: 'Export Freshness & Drift Detector',
  version: '1.0.0',
  description:
    'Checks export age and warns when data files are likely stale compared to current Instagram state.',
  defaultEnabled: true,
  analyze(ctx: AnalyzerContext): AnalyzerInsight[] {
    const refTime = ctx.snapshot.exportGeneratedAt || ctx.snapshot.createdAt;
    const ageDays = Math.max(0, Math.floor((Date.now() - refTime) / (1000 * 60 * 60 * 24)));
    const unverifiedCount = ctx.accounts.filter(
      (a) => a.isNotFollowingBack && a.verificationStatus === 'unverified',
    ).length;

    if (ctx.snapshot.sourceKind === 'live_sync') {
      return [
        {
          id: 'freshness-live',
          moduleId: this.id,
          severity: 'success',
          title: 'Live-Verified Snapshot Active',
          summary: 'This dataset reflects a direct live synchronization rather than an older static export.',
          metricValue: 'Live',
        },
      ];
    }

    if (ageDays >= 7 && unverifiedCount > 0) {
      return [
        {
          id: 'freshness-stale',
          moduleId: this.id,
          severity: 'warning',
          title: `Export Data Is ~${ageDays} Days Old`,
          summary: `${unverifiedCount} non-mutual accounts have not been fact-checked against live Instagram yet. Run a Live Fact-Check to catch accounts you already unfollowed or who followed you back.`,
          metricValue: `${ageDays}d old`,
          filterSegment: 'not_following_back',
        },
      ];
    }

    return [
      {
        id: 'freshness-ok',
        moduleId: this.id,
        severity: 'info',
        title: `Export Age: ${ageDays === 0 ? 'Today' : `${ageDays}d ago`}`,
        summary:
          unverifiedCount > 0
            ? `${unverifiedCount} non-mutual accounts can still be live-verified before unfollowing.`
            : 'All non-mutual accounts in this snapshot have been fact-checked.',
        metricValue: ageDays === 0 ? 'Fresh' : `${ageDays}d`,
      },
    ];
  },
};

export const nonMutualHygieneAnalyzer: AnalyzerModule = {
  id: 'analyzer-non-mutual-hygiene',
  name: 'Non-Mutual Hygiene & Oldest Follows',
  version: '1.0.0',
  description:
    'Highlights non-reciprocal follows, protected accounts, and long-standing unreciprocated follows.',
  defaultEnabled: true,
  analyze(ctx: AnalyzerContext): AnalyzerInsight[] {
    const nonFollowers = ctx.accounts.filter(
      (a) => a.isNotFollowingBack && a.unfollowState !== 'unfollowed',
    );
    const actionable = nonFollowers.filter((a) => !a.whitelisted && !a.protectedByRule);
    const oldest = [...actionable]
      .filter((a) => Boolean(a.followedAt))
      .sort((a, b) => (a.followedAt ?? 0) - (b.followedAt ?? 0))
      .slice(0, 5);

    const insights: AnalyzerInsight[] = [];

    if (actionable.length > 0) {
      insights.push({
        id: 'non-mutual-actionable',
        moduleId: this.id,
        severity: 'action',
        title: 'Actionable Non-Mutual Accounts',
        summary: `${actionable.length} accounts do not follow you back (excluding ${nonFollowers.length - actionable.length} whitelisted or protected by smart rules).`,
        metricValue: actionable.length,
        filterSegment: 'not_following_back',
        accountsSample: actionable.slice(0, 5).map((a) => a.username),
      });
    }

    if (oldest.length > 0 && oldest[0].followedAt) {
      const oldestDays = Math.floor(
        (Date.now() - oldest[0].followedAt) / (1000 * 60 * 60 * 24),
      );
      insights.push({
        id: 'non-mutual-oldest',
        moduleId: this.id,
        severity: 'info',
        title: `Oldest Unreciprocated Follow: ${oldestDays}d`,
        summary: `Long-standing follows that never followed back include @${oldest.map((o) => o.username).join(', @')}.`,
        metricValue: `${oldestDays}d`,
        filterSegment: 'not_following_back',
        accountsSample: oldest.map((o) => o.username),
      });
    }

    return insights;
  },
};

export const pendingRequestsAnalyzer: AnalyzerModule = {
  id: 'analyzer-pending-requests',
  name: 'Stale Outbound Follow Requests',
  version: '1.0.0',
  description:
    'Finds unanswered outbound follow requests to private accounts sitting in pending_follow_requests.',
  defaultEnabled: true,
  analyze(ctx: AnalyzerContext): AnalyzerInsight[] {
    const pending = ctx.accounts.filter((a) => a.isPendingRequest);
    if (pending.length === 0) return [];

    const oldPending = pending.filter(
      (a) => a.pendingSince && Date.now() - a.pendingSince > 30 * 24 * 60 * 60 * 1000,
    );

    return [
      {
        id: 'pending-requests-summary',
        moduleId: this.id,
        severity: oldPending.length > 0 ? 'warning' : 'info',
        title: `${pending.length} Pending Outbound Follow Requests`,
        summary:
          oldPending.length > 0
            ? `${oldPending.length} of these sent follow requests have been unanswered for over 30 days.`
            : 'These private accounts still have not accepted your outbound follow request.',
        metricValue: pending.length,
        filterSegment: 'pending_requests',
        accountsSample: pending.slice(0, 5).map((a) => a.username),
      },
    ];
  },
};

export const liveDriftAnalyzer: AnalyzerModule = {
  id: 'analyzer-live-drift',
  name: 'Export vs Live Reality Reconciler',
  version: '1.0.0',
  description:
    'Surfaces false positives from outdated exports (already unfollowed, newly mutual, or deactivated accounts).',
  defaultEnabled: true,
  analyze(ctx: AnalyzerContext): AnalyzerInsight[] {
    const { verificationCounts } = ctx;
    const staleCleared =
      verificationCounts.already_unfollowed + verificationCounts.actually_follows_back;
    const missing = verificationCounts.deactivated_or_missing;

    const insights: AnalyzerInsight[] = [];
    if (staleCleared > 0) {
      insights.push({
        id: 'drift-false-positives',
        moduleId: this.id,
        severity: 'success',
        title: `${staleCleared} Outdated Export Entries Auto-Reconciled`,
        summary: `${verificationCounts.already_unfollowed} already unfollowed + ${verificationCounts.actually_follows_back} now follow you back compared to the export file.`,
        metricValue: staleCleared,
        filterSegment: 'stale_already_unfollowed',
      });
    }

    if (missing > 0) {
      insights.push({
        id: 'drift-missing',
        moduleId: this.id,
        severity: 'warning',
        title: `${missing} Deactivated or Missing Accounts Detected`,
        summary:
          'These handles from your export no longer resolved during live fact-checking (deactivated, banned, or renamed).',
        metricValue: missing,
        filterSegment: 'deactivated_missing',
      });
    }

    return insights;
  },
};

let analyzersRegistered = false;

export function ensureBuiltinAnalyzersRegistered(
  registry: PluginRegistry = defaultPluginRegistry,
): void {
  if (analyzersRegistered && registry === defaultPluginRegistry) return;
  registry.registerAnalyzer(exportFreshnessAnalyzer);
  registry.registerAnalyzer(nonMutualHygieneAnalyzer);
  registry.registerAnalyzer(pendingRequestsAnalyzer);
  registry.registerAnalyzer(liveDriftAnalyzer);
  if (registry === defaultPluginRegistry) {
    analyzersRegistered = true;
  }
}
