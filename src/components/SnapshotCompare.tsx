import { useMemo, useState } from 'react';
import { ArrowRightLeft, Download, Plus } from 'lucide-react';
import { diffSnapshots } from '../core/reconciliation/engine';
import type { AccountEntry, ExportSnapshot, LiveGraphPayload } from '../core/types';
import { downloadTextFile, formatShortDate } from './shared';

interface SnapshotCompareProps {
  snapshots: ExportSnapshot[];
  liveGraph: LiveGraphPayload | null;
  onPromoteLiveGraphToSnapshot: () => void;
}

export function SnapshotCompare({
  snapshots,
  liveGraph,
  onPromoteLiveGraphToSnapshot,
}: SnapshotCompareProps) {
  const sorted = useMemo(
    () =>
      [...snapshots].sort(
        (a, b) => (a.exportGeneratedAt || a.createdAt) - (b.exportGeneratedAt || b.createdAt),
      ),
    [snapshots],
  );

  const [olderId, setOlderId] = useState<string>(sorted[0]?.id ?? '');
  const [newerId, setNewerId] = useState<string>(sorted[sorted.length - 1]?.id ?? '');

  const older = sorted.find((s) => s.id === olderId) ?? sorted[0];
  const newer = sorted.find((s) => s.id === newerId) ?? sorted[sorted.length - 1];

  const diff = useMemo(() => {
    if (!older || !newer || older.id === newer.id) return null;
    return diffSnapshots(older, newer);
  }, [older, newer]);

  function renderAccountList(title: string, badgeClass: string, items: AccountEntry[]) {
    return (
      <div className="card-subtle stack-sm">
        <div className="space-between">
          <strong>{title}</strong>
          <span className={`pill ${badgeClass}`}>{items.length}</span>
        </div>
        <div style={{ maxHeight: 240, overflowY: 'auto' }} className="stack-sm">
          {items.length === 0 ? (
            <span className="muted" style={{ fontSize: '0.84rem' }}>None detected.</span>
          ) : (
            items.map((e) => (
              <div key={e.username} className="space-between" style={{ fontSize: '0.84rem' }}>
                <a href={e.profileUrl} target="_blank" rel="noreferrer">
                  @{e.username}
                </a>
                {e.timestamp && <span className="muted">{formatShortDate(e.timestamp)}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="stack-md">
      <div className="card stack-sm">
        <div className="space-between">
          <div>
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Snapshot Timeline Diff</h2>
            <p className="muted" style={{ margin: '2px 0 0', fontSize: '0.86rem' }}>
              Compare any two Instagram exports (or save a Live Sync as a snapshot) to discover exact
              unfollowers, new followers, and following changes over time.
            </p>
          </div>

          {liveGraph && (
            <button type="button" className="btn btn-cyan btn-sm" onClick={onPromoteLiveGraphToSnapshot}>
              <Plus size={14} /> Save Current Live Sync as Snapshot
            </button>
          )}
        </div>

        {sorted.length < 2 ? (
          <div className="banner banner-info" style={{ marginBottom: 0 }}>
            Import at least 2 exports (or run a Live Sync and click "Save Current Live Sync as Snapshot") to compare timeline changes.
          </div>
        ) : (
          <div className="row-flex">
            <select
              className="select"
              value={older?.id ?? ''}
              onChange={(e) => setOlderId(e.target.value)}
              aria-label="Older baseline snapshot"
            >
              {sorted.map((s) => (
                <option key={s.id} value={s.id}>
                  Older: {s.label} ({formatShortDate(s.exportGeneratedAt || s.createdAt)})
                </option>
              ))}
            </select>

            <ArrowRightLeft size={16} className="muted" />

            <select
              className="select"
              value={newer?.id ?? ''}
              onChange={(e) => setNewerId(e.target.value)}
              aria-label="Newer comparison snapshot"
            >
              {sorted.map((s) => (
                <option key={s.id} value={s.id}>
                  Newer: {s.label} ({formatShortDate(s.exportGeneratedAt || s.createdAt)})
                </option>
              ))}
            </select>

            {diff && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  downloadTextFile(
                    'ig-snapshot-diff.json',
                    JSON.stringify(diff, null, 2),
                    'application/json',
                  )
                }
              >
                <Download size={13} /> Export Diff JSON
              </button>
            )}
          </div>
        )}
      </div>

      {diff && (
        <div className="grid-2">
          {renderAccountList('Lost Followers (Unfollowed You)', 'pill-danger', diff.lostFollowers)}
          {renderAccountList('Gained Followers', 'pill-success', diff.gainedFollowers)}
          {renderAccountList('New Accounts You Followed', 'pill-info', diff.newFollowings)}
          {renderAccountList('Accounts You Unfollowed', 'pill-neutral', diff.removedFollowings)}
        </div>
      )}
    </div>
  );
}
