import { AlertTriangle, ArrowRight, CheckCircle2, Info, ShieldCheck } from 'lucide-react';
import type {
  AccountSegment,
  AnalyzerInsight,
  EnrichedAccount,
  ExportSnapshot,
  ReconciledSummary,
  WorkspaceTabId,
} from '../core/types';
import { formatRelativeAge, formatShortDate } from './shared';

interface OverviewDashboardProps {
  snapshot: ExportSnapshot;
  accounts: EnrichedAccount[];
  insights: AnalyzerInsight[];
  reconciliation: ReconciledSummary;
  onNavigateSegment: (segment: AccountSegment) => void;
  onNavigateTab: (tab: WorkspaceTabId) => void;
  onQueueConfirmed: () => void;
}

export function OverviewDashboard({
  snapshot,
  accounts,
  insights,
  reconciliation,
  onNavigateSegment,
  onNavigateTab,
  onQueueConfirmed,
}: OverviewDashboardProps) {
  const followingCount = accounts.filter((a) => a.isFollowing).length;
  const followersCount = accounts.filter((a) => a.isFollower).length;
  const mutualsCount = accounts.filter((a) => a.isMutual).length;
  const notFollowingBack = accounts.filter(
    (a) => a.isNotFollowingBack && a.unfollowState !== 'unfollowed',
  );
  const fansCount = accounts.filter((a) => a.isFan).length;
  const pendingCount = accounts.filter((a) => a.isPendingRequest).length;
  const protectedCount = accounts.filter((a) => a.whitelisted || Boolean(a.protectedByRule)).length;

  const totalGraph = Math.max(1, mutualsCount + notFollowingBack.length + fansCount);
  const mutualPct = Math.round((mutualsCount / totalGraph) * 100);
  const nonFollowPct = Math.round((notFollowingBack.length / totalGraph) * 100);
  const fanPct = Math.max(0, 100 - mutualPct - nonFollowPct);

  const exportAgeDays = snapshot.exportGeneratedAt
    ? Math.floor((Date.now() - snapshot.exportGeneratedAt) / (1000 * 60 * 60 * 24))
    : 0;

  return (
    <div className="stack-md">
      {snapshot.warnings.length > 0 && (
        <div className="banner banner-warning">
          <div className="stack-sm" style={{ gap: 4 }}>
            {snapshot.warnings.map((w, idx) => (
              <div key={idx} className="row-flex">
                <AlertTriangle size={16} />
                <span>{w}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {exportAgeDays >= 7 && reconciliation.unverified > 0 && (
        <div className="banner banner-info">
          <div className="row-flex">
            <Info size={18} />
            <span>
              <strong>Export Freshness Notice:</strong> This export is{' '}
              <strong>{exportAgeDays} days old</strong> ({formatShortDate(snapshot.exportGeneratedAt)}).{' '}
              {reconciliation.unverified} non-mutual accounts are unverified against live Instagram.
            </span>
          </div>
          <button
            type="button"
            className="btn btn-cyan btn-sm"
            onClick={() => onNavigateTab('fact-check')}
          >
            Fact-Check Against Live Reality <ArrowRight size={14} />
          </button>
        </div>
      )}

      <div className="grid-kpis">
        <button
          type="button"
          className="kpi-card"
          onClick={() => onNavigateSegment('not_following_back')}
        >
          <div className="kpi-label">Not Following Back</div>
          <div className="kpi-value" style={{ color: 'var(--accent)' }}>
            {notFollowingBack.length}
          </div>
          <div className="kpi-hint">
            {reconciliation.confirmedNotFollowingBack > 0
              ? `${reconciliation.confirmedNotFollowingBack} live-confirmed`
              : 'Click to inspect & queue'}
          </div>
        </button>

        <button type="button" className="kpi-card" onClick={() => onNavigateSegment('mutuals')}>
          <div className="kpi-label">Mutuals</div>
          <div className="kpi-value" style={{ color: 'var(--success)' }}>
            {mutualsCount}
          </div>
          <div className="kpi-hint">Follow each other</div>
        </button>

        <button type="button" className="kpi-card" onClick={() => onNavigateSegment('all')}>
          <div className="kpi-label">Following / Followers</div>
          <div className="kpi-value">
            {followingCount} <span className="muted" style={{ fontSize: '1.1rem' }}>/ {followersCount}</span>
          </div>
          <div className="kpi-hint">
            Ratio {followersCount > 0 ? (followingCount / followersCount).toFixed(2) : '—'}
          </div>
        </button>

        <button type="button" className="kpi-card" onClick={() => onNavigateSegment('fans')}>
          <div className="kpi-label">Fans (Follow You)</div>
          <div className="kpi-value" style={{ color: 'var(--accent-2)' }}>
            {fansCount}
          </div>
          <div className="kpi-hint">You do not follow back</div>
        </button>

        <button
          type="button"
          className="kpi-card"
          onClick={() => onNavigateSegment('pending_requests')}
        >
          <div className="kpi-label">Pending Sent Requests</div>
          <div className="kpi-value" style={{ color: 'var(--warning)' }}>
            {pendingCount}
          </div>
          <div className="kpi-hint">Unanswered private requests</div>
        </button>

        <button type="button" className="kpi-card" onClick={() => onNavigateSegment('whitelisted')}>
          <div className="kpi-label">Protected / Safe List</div>
          <div className="kpi-value">{protectedCount}</div>
          <div className="kpi-hint">Shielded from unfollow queue</div>
        </button>
      </div>

      <div className="grid-2">
        <div className="card stack-sm">
          <div className="space-between">
            <strong>Graph Composition</strong>
            <span className="muted" style={{ fontSize: '0.82rem' }}>
              Format: <code className="mono">{snapshot.sourceFormat.toUpperCase()}</code> · Exported{' '}
              {formatRelativeAge(snapshot.exportGeneratedAt)}
            </span>
          </div>

          <div className="ratio-bar" aria-label="Relationship breakdown bar">
            <div style={{ width: `${mutualPct}%`, background: 'var(--success)' }} title={`Mutuals ${mutualPct}%`} />
            <div style={{ width: `${nonFollowPct}%`, background: 'var(--accent)' }} title={`Not Following Back ${nonFollowPct}%`} />
            <div style={{ width: `${fanPct}%`, background: 'var(--accent-2)' }} title={`Fans ${fanPct}%`} />
          </div>

          <div className="row-flex" style={{ fontSize: '0.82rem' }}>
            <span className="pill pill-success">Mutuals {mutualPct}%</span>
            <span className="pill pill-accent">Not Following Back {nonFollowPct}%</span>
            <span className="pill pill-info">Fans {fanPct}%</span>
          </div>

          <div className="row-flex" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => onNavigateSegment('not_following_back')}
            >
              Review Non-Followers
            </button>
            <button
              type="button"
              className="btn btn-cyan btn-sm"
              onClick={() => onNavigateTab('fact-check')}
            >
              Run Live Fact-Check
            </button>
            <button type="button" className="btn btn-sm" onClick={onQueueConfirmed}>
              Queue Actionable Non-Followers
            </button>
          </div>
        </div>

        <div className="card stack-sm">
          <div className="space-between">
            <strong>Reconciliation & Freshness</strong>
            <span className="pill pill-neutral">
              {snapshot.ownerUsername ? `@${snapshot.ownerUsername}` : 'Local Snapshot'}
            </span>
          </div>
          <div className="grid-2" style={{ gap: 8 }}>
            <div className="card-subtle">
              <div className="muted" style={{ fontSize: '0.76rem' }}>Confirmed Non-Mutuals</div>
              <strong style={{ fontSize: '1.15rem', color: 'var(--accent)' }}>
                {reconciliation.confirmedNotFollowingBack}
              </strong>
            </div>
            <div className="card-subtle">
              <div className="muted" style={{ fontSize: '0.76rem' }}>Stale False Positives Cleared</div>
              <strong style={{ fontSize: '1.15rem', color: 'var(--success)' }}>
                {reconciliation.alreadyUnfollowed + reconciliation.nowFollowsBack}
              </strong>
            </div>
            <div className="card-subtle">
              <div className="muted" style={{ fontSize: '0.76rem' }}>Missing / Deactivated</div>
              <strong style={{ fontSize: '1.15rem', color: 'var(--warning)' }}>
                {reconciliation.deactivatedOrMissing}
              </strong>
            </div>
            <div className="card-subtle">
              <div className="muted" style={{ fontSize: '0.76rem' }}>Still Unverified</div>
              <strong style={{ fontSize: '1.15rem' }}>{reconciliation.unverified}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="card stack-sm">
        <div className="space-between">
          <strong>Analyzer Module Insights ({insights.length})</strong>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => onNavigateTab('modules')}
          >
            Configure Modules
          </button>
        </div>

        <div className="grid-2">
          {insights.map((ins) => (
            <div key={ins.id} className="card-subtle stack-sm" style={{ gap: 6 }}>
              <div className="space-between">
                <div className="row-flex" style={{ gap: 6 }}>
                  {ins.severity === 'success' && <CheckCircle2 size={15} style={{ color: 'var(--success)' }} />}
                  {ins.severity === 'warning' && <AlertTriangle size={15} style={{ color: 'var(--warning)' }} />}
                  {ins.severity === 'action' && <ShieldCheck size={15} style={{ color: 'var(--accent)' }} />}
                  {ins.severity === 'info' && <Info size={15} style={{ color: 'var(--accent-2)' }} />}
                  <strong>{ins.title}</strong>
                </div>
                {ins.metricValue !== undefined && (
                  <span className="pill pill-neutral">{ins.metricValue}</span>
                )}
              </div>
              <p className="muted" style={{ margin: 0, fontSize: '0.84rem' }}>
                {ins.summary}
              </p>
              {ins.filterSegment && (
                <div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => onNavigateSegment(ins.filterSegment!)}
                  >
                    View Segment <ArrowRight size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card stack-sm">
        <div className="space-between">
          <strong>Files Scanned ({snapshot.filesScanned.length})</strong>
          <span className="muted" style={{ fontSize: '0.82rem' }}>
            Skipped {snapshot.skippedFilesCount} non-relationship / media entries
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>File Path</th>
                <th>Format</th>
                <th>Detected Dataset</th>
                <th>Records</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.filesScanned.map((f) => (
                <tr key={f.path}>
                  <td className="mono" style={{ fontSize: '0.8rem' }}>{f.path}</td>
                  <td><span className="pill pill-neutral">{f.format.toUpperCase()}</span></td>
                  <td><span className="pill pill-info">{f.category}</span></td>
                  <td>{f.entriesExtracted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
