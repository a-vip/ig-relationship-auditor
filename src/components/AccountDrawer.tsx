import { useState } from 'react';
import { ExternalLink, Shield, ShieldOff, UserMinus, X, Zap } from 'lucide-react';
import type { AccountMetadata, EnrichedAccount } from '../core/types';
import { formatRelativeAge, formatShortDate, VerificationBadge } from './shared';

interface AccountDrawerProps {
  account: EnrichedAccount;
  onClose: () => void;
  onUpdateMetadata: (username: string, patch: Partial<AccountMetadata>) => void;
  onQueueAccount: (username: string) => void;
  onLiveProbeAccount: (username: string) => void;
  canLiveVerify: boolean;
}

export function AccountDrawer({
  account,
  onClose,
  onUpdateMetadata,
  onQueueAccount,
  onLiveProbeAccount,
  canLiveVerify,
}: AccountDrawerProps) {
  const [tagInput, setTagInput] = useState(account.tags.join(', '));
  const [noteInput, setNoteInput] = useState(account.note);
  const [whitelistReason, setWhitelistReason] = useState(account.whitelistReason || '');

  function saveNotesAndTags() {
    const tags = tagInput
      .split(',')
      .map((s) => s.trim().replace(/^#/, ''))
      .filter(Boolean);
    onUpdateMetadata(account.username, { tags, note: noteInput });
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer-panel stack-md" onClick={(e) => e.stopPropagation()}>
        <div className="space-between">
          <div>
            <h2 style={{ margin: 0 }}>@{account.username}</h2>
            {(account.liveProbe?.fullName || account.displayName) && (
              <div className="muted">{account.liveProbe?.fullName || account.displayName}</div>
            )}
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close details">
            <X size={16} />
          </button>
        </div>

        <div className="row-flex">
          <VerificationBadge status={account.verificationStatus} />
          {account.isCloseFriend && <span className="pill pill-info">Close Friend</span>}
          {account.isFavorite && <span className="pill pill-info">Favorite</span>}
          {account.whitelisted && <span className="pill pill-success">Whitelisted</span>}
          {account.protectedByRule && (
            <span className="pill pill-success">Rule: {account.protectedByRule}</span>
          )}
        </div>

        <div className="row-flex">
          <a
            href={account.profileUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-sm"
          >
            <ExternalLink size={14} /> Open Profile
          </a>
          <button
            type="button"
            className="btn btn-cyan btn-sm"
            disabled={!canLiveVerify}
            onClick={() => onLiveProbeAccount(account.username)}
          >
            <Zap size={14} /> Fact-Check Live
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={account.whitelisted || Boolean(account.protectedByRule)}
            onClick={() => onQueueAccount(account.username)}
          >
            <UserMinus size={14} /> Queue Unfollow
          </button>
        </div>

        <div className="card-subtle stack-sm">
          <strong>Relationship Timeline</strong>
          <div style={{ fontSize: '0.84rem' }} className="stack-sm">
            <div>
              <span className="muted">You Followed:</span>{' '}
              {formatShortDate(account.followedAt)} ({formatRelativeAge(account.followedAt)})
            </div>
            <div>
              <span className="muted">Followed You Back:</span>{' '}
              {account.isFollower
                ? `${formatShortDate(account.followedBackAt)} (${formatRelativeAge(account.followedBackAt)})`
                : 'No'}
            </div>
            {account.pendingSince && (
              <div>
                <span className="muted">Pending Request Sent:</span>{' '}
                {formatShortDate(account.pendingSince)}
              </div>
            )}
            <div>
              <span className="muted">Source Files:</span>{' '}
              <code className="mono" style={{ fontSize: '0.78rem' }}>
                {account.sourceFiles.join(', ') || 'Live sync'}
              </code>
            </div>
          </div>
        </div>

        {account.liveProbe && (
          <div className="card-subtle stack-sm">
            <strong>Live Probe Telemetry ({account.liveProbe.method})</strong>
            <div style={{ fontSize: '0.84rem' }} className="stack-sm">
              <div>
                <span className="muted">Account Exists:</span>{' '}
                {account.liveProbe.accountExists ? 'Yes' : 'No (Missing/Deactivated)'}
              </div>
              {account.liveProbe.followerCount !== undefined && (
                <div>
                  <span className="muted">Followers / Following:</span>{' '}
                  {account.liveProbe.followerCount.toLocaleString()} /{' '}
                  {account.liveProbe.followingCount?.toLocaleString() ?? '—'}
                </div>
              )}
              <div>
                <span className="muted">Checked:</span>{' '}
                {formatRelativeAge(account.liveProbe.checkedAt)}
              </div>
            </div>
          </div>
        )}

        <div className="card-subtle stack-sm">
          <strong>Safe List (Whitelist)</strong>
          <input
            type="text"
            className="input"
            placeholder="Optional reason (e.g. IRL friend, favorite creator)"
            value={whitelistReason}
            onChange={(e) => setWhitelistReason(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              onUpdateMetadata(account.username, {
                whitelisted: !account.whitelisted,
                whitelistReason: !account.whitelisted ? whitelistReason || 'Manually whitelisted' : '',
              })
            }
          >
            {account.whitelisted ? (
              <>
                <ShieldOff size={14} /> Remove from Whitelist
              </>
            ) : (
              <>
                <Shield size={14} /> Add to Whitelist
              </>
            )}
          </button>
        </div>

        <div className="card-subtle stack-sm">
          <strong>Tags & Personal Notes</strong>
          <input
            type="text"
            className="input"
            placeholder="Tags separated by commas (e.g. friend, photography, vip)"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
          />
          <textarea
            className="textarea"
            rows={4}
            placeholder="Private note saved locally in your browser IndexedDB..."
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={saveNotesAndTags}>
            Save Tags & Note
          </button>
        </div>
      </div>
    </div>
  );
}
