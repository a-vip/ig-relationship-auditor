import type { VerificationStatus } from '../core/types';

export function formatRelativeAge(ms?: number): string {
  if (!ms) return '—';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return 'just now';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function formatShortDate(ms?: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function downloadTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const VERIFICATION_META: Record<
  VerificationStatus,
  { label: string; pillClass: string }
> = {
  unverified: { label: 'Unverified (Export)', pillClass: 'pill-neutral' },
  verifying: { label: 'Checking Live...', pillClass: 'pill-info' },
  confirmed_not_following_back: { label: 'Confirmed Non-Mutual', pillClass: 'pill-danger' },
  verified_mutual: { label: 'Verified Mutual', pillClass: 'pill-success' },
  actually_follows_back: { label: 'Now Follows Back', pillClass: 'pill-success' },
  already_unfollowed: { label: 'Already Unfollowed', pillClass: 'pill-success' },
  new_non_follower: { label: 'New Non-Follower', pillClass: 'pill-warning' },
  deactivated_or_missing: { label: 'Missing / Deactivated', pillClass: 'pill-warning' },
  handle_changed: { label: 'Handle Changed', pillClass: 'pill-info' },
  rate_limited: { label: 'Rate Limited', pillClass: 'pill-warning' },
  error: { label: 'Check Error', pillClass: 'pill-warning' },
};

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const meta = VERIFICATION_META[status] ?? VERIFICATION_META.unverified;
  return <span className={`pill ${meta.pillClass}`}>{meta.label}</span>;
}
