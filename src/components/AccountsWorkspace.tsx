import { useMemo, useState } from 'react';
import {
  CheckSquare,
  Download,
  ExternalLink,
  Search,
  Shield,
  ShieldOff,
  UserMinus,
  Zap,
} from 'lucide-react';
import { filterAccountsBySegment } from '../core/reconciliation/engine';
import { exportAccountsToCsv } from '../core/storage/db';
import type { AccountSegment, EnrichedAccount } from '../core/types';
import { downloadTextFile, formatRelativeAge, formatShortDate, VerificationBadge } from './shared';

interface AccountsWorkspaceProps {
  accounts: EnrichedAccount[];
  activeSegment: AccountSegment;
  onChangeSegment: (seg: AccountSegment) => void;
  unfollowQueue: string[];
  onQueueUsernames: (usernames: string[]) => void;
  onToggleWhitelist: (usernames: string[], whitelisted: boolean, reason?: string) => void;
  onLiveVerifyUsernames: (usernames: string[]) => void;
  canLiveVerify: boolean;
  onSelectAccount: (username: string) => void;
}

const SEGMENTS: Array<{ id: AccountSegment; label: string }> = [
  { id: 'not_following_back', label: 'Not Following Back' },
  { id: 'confirmed_non_mutual', label: 'Confirmed Non-Mutuals' },
  { id: 'stale_already_unfollowed', label: 'Stale / Already Unfollowed' },
  { id: 'mutuals', label: 'Mutuals' },
  { id: 'fans', label: 'Fans' },
  { id: 'pending_requests', label: 'Pending Requests' },
  { id: 'close_friends', label: 'Close Friends' },
  { id: 'whitelisted', label: 'Protected / Whitelisted' },
  { id: 'deactivated_missing', label: 'Deactivated / Missing' },
  { id: 'unfollowed_log', label: 'Unfollowed' },
  { id: 'all', label: 'All Accounts' },
];

type SortMode = 'username_asc' | 'followed_oldest' | 'followed_newest' | 'status';

export function AccountsWorkspace({
  accounts,
  activeSegment,
  onChangeSegment,
  unfollowQueue,
  onQueueUsernames,
  onToggleWhitelist,
  onLiveVerifyUsernames,
  canLiveVerify,
  onSelectAccount,
}: AccountsWorkspaceProps) {
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('followed_oldest');
  const [hideProtected, setHideProtected] = useState(false);
  const [unverifiedOnly, setUnverifiedOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const queueSet = useMemo(() => new Set(unfollowQueue), [unfollowQueue]);

  const segmentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const seg of SEGMENTS) {
      counts[seg.id] = filterAccountsBySegment(accounts, seg.id).length;
    }
    return counts;
  }, [accounts]);

  const filtered = useMemo(() => {
    let list = filterAccountsBySegment(accounts, activeSegment);

    if (hideProtected) {
      list = list.filter((a) => !a.whitelisted && !a.protectedByRule);
    }
    if (unverifiedOnly) {
      list = list.filter((a) => a.verificationStatus === 'unverified');
    }

    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (a) =>
          a.username.includes(q) ||
          (a.displayName && a.displayName.toLowerCase().includes(q)) ||
          a.note.toLowerCase().includes(q) ||
          a.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sortMode === 'username_asc') return a.username.localeCompare(b.username);
      if (sortMode === 'followed_oldest') {
        return (a.followedAt ?? Number.MAX_SAFE_INTEGER) - (b.followedAt ?? Number.MAX_SAFE_INTEGER);
      }
      if (sortMode === 'followed_newest') {
        return (b.followedAt ?? 0) - (a.followedAt ?? 0);
      }
      return a.verificationStatus.localeCompare(b.verificationStatus);
    });

    return sorted;
  }, [accounts, activeSegment, hideProtected, unverifiedOnly, query, sortMode]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const selectedArray = Array.from(selected).filter((u) =>
    filtered.some((a) => a.username === u),
  );

  function toggleOne(username: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  }

  function toggleAllOnPage() {
    const allSelected = pageItems.length > 0 && pageItems.every((i) => selected.has(i.username));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const item of pageItems) {
        if (allSelected) next.delete(item.username);
        else next.add(item.username);
      }
      return next;
    });
  }

  function selectAllFiltered() {
    setSelected(new Set(filtered.map((a) => a.username)));
  }

  return (
    <div className="stack-md">
      <div className="card stack-sm">
        <div className="row-flex" style={{ gap: 6 }}>
          {SEGMENTS.map((seg) => (
            <button
              key={seg.id}
              type="button"
              className={`btn btn-sm ${activeSegment === seg.id ? 'btn-primary' : ''}`}
              onClick={() => {
                onChangeSegment(seg.id);
                setPage(0);
              }}
            >
              {seg.label}{' '}
              <span className="nav-badge" style={{ marginLeft: 2 }}>
                {segmentCounts[seg.id] ?? 0}
              </span>
            </button>
          ))}
        </div>

        <div className="space-between" style={{ marginTop: 6 }}>
          <div className="row-flex" style={{ flex: 1 }}>
            <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 380 }}>
              <Search
                size={15}
                style={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                }}
              />
              <input
                type="search"
                className="input"
                style={{ width: '100%', paddingLeft: 32 }}
                placeholder="Search @handle, name, tag, note..."
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </div>

            <select
              className="select"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              aria-label="Sort accounts"
            >
              <option value="followed_oldest">Oldest Followed First</option>
              <option value="followed_newest">Newest Followed First</option>
              <option value="username_asc">Username A–Z</option>
              <option value="status">Verification Status</option>
            </select>

            <label className="row-flex" style={{ fontSize: '0.84rem', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={hideProtected}
                onChange={(e) => setHideProtected(e.target.checked)}
              />
              Hide Protected
            </label>

            <label className="row-flex" style={{ fontSize: '0.84rem', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={unverifiedOnly}
                onChange={(e) => setUnverifiedOnly(e.target.checked)}
              />
              Unverified Only
            </label>
          </div>

          <div className="row-flex">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() =>
                downloadTextFile(
                  `ig-audit-${activeSegment}.csv`,
                  exportAccountsToCsv(filtered),
                  'text/csv;charset=utf-8',
                )
              }
            >
              <Download size={14} /> CSV ({filtered.length})
            </button>
          </div>
        </div>
      </div>

      {/* Bulk Toolbar */}
      <div className="card-subtle space-between">
        <div className="row-flex">
          <span className="pill pill-info">{selectedArray.length} selected</span>
          <button type="button" className="btn btn-sm" onClick={selectAllFiltered}>
            <CheckSquare size={14} /> Select All Filtered ({filtered.length})
          </button>
          {selectedArray.length > 0 && (
            <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())}>
              Clear Selection
            </button>
          )}
        </div>

        <div className="row-flex">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={selectedArray.length === 0}
            onClick={() => onQueueUsernames(selectedArray)}
          >
            <UserMinus size={14} /> Queue for Unfollow ({selectedArray.length})
          </button>

          <button
            type="button"
            className="btn btn-cyan btn-sm"
            disabled={selectedArray.length === 0 || !canLiveVerify}
            title={
              canLiveVerify
                ? 'Verify selected accounts live'
                : 'Connect Browser Extension or Local Companion in Fact-Check tab first'
            }
            onClick={() => onLiveVerifyUsernames(selectedArray)}
          >
            <Zap size={14} /> Fact-Check Selected
          </button>

          <button
            type="button"
            className="btn btn-sm"
            disabled={selectedArray.length === 0}
            onClick={() => onToggleWhitelist(selectedArray, true, 'Bulk whitelisted')}
          >
            <Shield size={14} /> Whitelist
          </button>

          <button
            type="button"
            className="btn btn-sm"
            disabled={selectedArray.length === 0}
            onClick={() => onToggleWhitelist(selectedArray, false)}
          >
            <ShieldOff size={14} /> Un-Whitelist
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrap" style={{ border: 0 }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 38 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all rows on page"
                    checked={pageItems.length > 0 && pageItems.every((i) => selected.has(i.username))}
                    onChange={toggleAllOnPage}
                  />
                </th>
                <th>Account</th>
                <th>Relationship</th>
                <th>Live Fact-Check</th>
                <th>Followed</th>
                <th>Protection / Tags</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 28 }} className="muted">
                    No accounts match this filter.
                  </td>
                </tr>
              ) : (
                pageItems.map((acc) => {
                  const isProtected = acc.whitelisted || Boolean(acc.protectedByRule);
                  const isQueued = queueSet.has(acc.username);
                  return (
                    <tr key={acc.username}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select @${acc.username}`}
                          checked={selected.has(acc.username)}
                          onChange={() => toggleOne(acc.username)}
                        />
                      </td>
                      <td>
                        <div className="stack-sm" style={{ gap: 2 }}>
                          <div className="row-flex" style={{ gap: 6 }}>
                            <button
                              type="button"
                              onClick={() => onSelectAccount(acc.username)}
                              style={{
                                background: 'none',
                                border: 0,
                                padding: 0,
                                cursor: 'pointer',
                                fontWeight: 700,
                                color: 'var(--accent-2)',
                              }}
                            >
                              @{acc.username}
                            </button>
                            {acc.liveProbe?.isVerified && (
                              <span className="pill pill-info" title="Verified badge">✓</span>
                            )}
                            {acc.liveProbe?.isPrivate && (
                              <span className="pill pill-neutral" title="Private account">Private</span>
                            )}
                          </div>
                          {(acc.displayName || acc.liveProbe?.fullName) && (
                            <span className="muted" style={{ fontSize: '0.78rem' }}>
                              {acc.liveProbe?.fullName || acc.displayName}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="row-flex" style={{ gap: 5 }}>
                          {acc.isMutual && <span className="pill pill-success">Mutual</span>}
                          {acc.isNotFollowingBack && (
                            <span className="pill pill-accent">Doesn't Follow Back</span>
                          )}
                          {acc.isFan && <span className="pill pill-info">Fan</span>}
                          {acc.isPendingRequest && <span className="pill pill-warning">Pending Sent</span>}
                          {acc.unfollowState === 'unfollowed' && (
                            <span className="pill pill-neutral">Unfollowed</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <VerificationBadge status={acc.verificationStatus} />
                      </td>
                      <td>
                        <div className="stack-sm" style={{ gap: 1 }}>
                          <span>{formatShortDate(acc.followedAt)}</span>
                          <span className="muted" style={{ fontSize: '0.75rem' }}>
                            {acc.followedAt ? formatRelativeAge(acc.followedAt) : acc.rawDate || '—'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="row-flex" style={{ gap: 4 }}>
                          {isProtected && (
                            <span className="pill pill-success">
                              <Shield size={11} /> {acc.whitelistReason || acc.protectedByRule}
                            </span>
                          )}
                          {acc.tags.map((t) => (
                            <span key={t} className="pill pill-neutral">#{t}</span>
                          ))}
                          {isQueued && <span className="pill pill-warning">In Queue</span>}
                        </div>
                      </td>
                      <td>
                        <div className="row-flex" style={{ gap: 6 }}>
                          <a
                            href={acc.profileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-sm"
                            title="Open Instagram profile"
                          >
                            <ExternalLink size={13} />
                          </a>
                          {!isProtected && acc.unfollowState !== 'unfollowed' && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => onQueueUsernames([acc.username])}
                              disabled={isQueued}
                            >
                              {isQueued ? 'Queued' : 'Queue'}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() =>
                              onToggleWhitelist([acc.username], !acc.whitelisted, 'Protected from table')
                            }
                            title={acc.whitelisted ? 'Remove whitelist' : 'Whitelist (keep following)'}
                          >
                            {acc.whitelisted ? <ShieldOff size={13} /> : <Shield size={13} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="space-between">
          <span className="muted" style={{ fontSize: '0.84rem' }}>
            Showing {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, filtered.length)} of{' '}
            {filtered.length}
          </span>
          <div className="row-flex">
            <button
              type="button"
              className="btn btn-sm"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </button>
            <span className="pill pill-neutral">
              Page {safePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
