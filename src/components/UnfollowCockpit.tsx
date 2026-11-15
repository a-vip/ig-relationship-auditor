import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Pause,
  Play,
  Shield,
  SkipForward,
  Square,
  Trash2,
  UserMinus,
} from 'lucide-react';
import {
  computeHumanDelayMs,
  computeRemainingDailyQuota,
  countActionsLast24Hours,
} from '../core/reconciliation/safetyRules';
import type { EnrichedAccount, SafetyConfig, UnfollowAuditEntry } from '../core/types';
import { downloadTextFile, formatRelativeAge, VerificationBadge } from './shared';

interface UnfollowCockpitProps {
  accountsByUsername: Map<string, EnrichedAccount>;
  unfollowQueue: string[];
  auditLog: UnfollowAuditEntry[];
  safetyConfig: SafetyConfig;
  onUpdateSafetyConfig: (patch: Partial<SafetyConfig>) => void;
  onRemoveFromQueue: (username: string) => void;
  onClearQueue: () => void;
  onPopulateQueueFromNonFollowers: (confirmedOnly: boolean) => void;
  onGuidedMarkUnfollowed: (username: string) => void;
  onGuidedWhitelistAndNext: (username: string) => void;
  onExecuteAutomatedUnfollow: (
    username: string,
    via: 'extension' | 'companion',
  ) => Promise<{ ok: boolean; rateLimited?: boolean; error?: string }>;
  extAuthenticated: boolean;
  companionAuthenticated: boolean;
}

export function UnfollowCockpit({
  accountsByUsername,
  unfollowQueue,
  auditLog,
  safetyConfig,
  onUpdateSafetyConfig,
  onRemoveFromQueue,
  onClearQueue,
  onPopulateQueueFromNonFollowers,
  onGuidedMarkUnfollowed,
  onGuidedWhitelistAndNext,
  onExecuteAutomatedUnfollow,
  extAuthenticated,
  companionAuthenticated,
}: UnfollowCockpitProps) {
  const [cockpitMode, setCockpitMode] = useState<'automated' | 'guided'>(
    extAuthenticated || companionAuthenticated ? 'automated' : 'guided',
  );
  const [preferredTransport, setPreferredTransport] = useState<'extension' | 'companion'>(
    extAuthenticated ? 'extension' : 'companion',
  );
  const [runnerState, setRunnerState] = useState<'idle' | 'running' | 'paused'>('idle');
  const [runnerMessage, setRunnerMessage] = useState('Ready');
  const [countdownSec, setCountdownSec] = useState<number | null>(null);
  const [guidedIndex, setGuidedIndex] = useState(0);

  const runnerStopRef = useRef(false);
  const popupRef = useRef<Window | null>(null);

  const usedToday = useMemo(() => countActionsLast24Hours(auditLog), [auditLog]);
  const remainingToday = useMemo(
    () => computeRemainingDailyQuota(auditLog, safetyConfig),
    [auditLog, safetyConfig],
  );

  const queueAccounts = useMemo(
    () =>
      unfollowQueue
        .map((u) => accountsByUsername.get(u))
        .filter((a): a is EnrichedAccount => Boolean(a)),
    [unfollowQueue, accountsByUsername],
  );

  const safeGuidedIndex = Math.min(guidedIndex, Math.max(0, queueAccounts.length - 1));
  const currentGuided = queueAccounts[safeGuidedIndex];

  function openSideProfileWindow(account: EnrichedAccount) {
    const left = Math.max(40, (window.screenX || 0) + window.outerWidth - 500);
    const top = Math.max(40, (window.screenY || 0) + 60);
    popupRef.current = window.open(
      account.profileUrl,
      'igAuditorProfileWindow',
      `width=470,height=760,left=${left},top=${top},noopener=false`,
    );
  }

  useEffect(() => {
    if (cockpitMode !== 'guided' || !currentGuided) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'o') {
        e.preventDefault();
        openSideProfileWindow(currentGuided);
      } else if (key === 'u') {
        e.preventDefault();
        onGuidedMarkUnfollowed(currentGuided.username);
      } else if (key === 'w') {
        e.preventDefault();
        onGuidedWhitelistAndNext(currentGuided.username);
      } else if (key === 's' || key === 'j') {
        e.preventDefault();
        setGuidedIndex((i) => Math.min(queueAccounts.length - 1, i + 1));
      } else if (key === 'k') {
        e.preventDefault();
        setGuidedIndex((i) => Math.max(0, i - 1));
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cockpitMode, currentGuided, queueAccounts.length, onGuidedMarkUnfollowed, onGuidedWhitelistAndNext]);

  async function startAutomatedRunner() {
    if (queueAccounts.length === 0) return;
    const via =
      preferredTransport === 'extension' && extAuthenticated
        ? 'extension'
        : companionAuthenticated
          ? 'companion'
          : null;
    if (!via) {
      setRunnerMessage('Connect Browser Extension or Local Companion in Fact-Check tab first.');
      return;
    }

    runnerStopRef.current = false;
    setRunnerState('running');

    const batchTargets = queueAccounts.slice(0, Math.min(safetyConfig.maxPerBatch, remainingToday));
    if (batchTargets.length === 0) {
      setRunnerState('idle');
      setRunnerMessage('24-hour safety cap reached. Wait before unfollowing more accounts.');
      return;
    }

    for (let i = 0; i < batchTargets.length; i += 1) {
      if (runnerStopRef.current) {
        setRunnerState('paused');
        setRunnerMessage('Paused by user.');
        setCountdownSec(null);
        return;
      }

      const acc = batchTargets[i];
      setRunnerMessage(`Processing @${acc.username} (${i + 1}/${batchTargets.length})...`);
      const res = await onExecuteAutomatedUnfollow(acc.username, via);

      if (res.rateLimited && safetyConfig.pauseOnRateLimit) {
        setRunnerState('paused');
        setRunnerMessage(
          `Safety circuit breaker triggered on @${acc.username}: ${res.error || 'Rate limit detected'}.`,
        );
        setCountdownSec(null);
        return;
      }

      if (i < batchTargets.length - 1 && !runnerStopRef.current) {
        const waitMs = computeHumanDelayMs(safetyConfig);
        const totalSec = Math.ceil(waitMs / 1000);
        for (let s = totalSec; s > 0; s -= 1) {
          if (runnerStopRef.current) break;
          setCountdownSec(s);
          setRunnerMessage(`Cooldown ${s}s before next unfollow (humanized jitter)...`);
          await new Promise((r) => setTimeout(r, 1000));
        }
        setCountdownSec(null);
      }
    }

    setRunnerState('idle');
    setRunnerMessage(`Batch complete (${batchTargets.length} processed).`);
  }

  function stopAutomatedRunner() {
    runnerStopRef.current = true;
    setRunnerState('paused');
    setCountdownSec(null);
  }

  return (
    <div className="stack-md">
      {/* Safety Guardrails Banner */}
      <div className="card stack-sm">
        <div className="space-between">
          <div>
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>In-System Unfollow Cockpit</h2>
            <p className="muted" style={{ margin: '2px 0 0', fontSize: '0.86rem' }}>
              Protected accounts and mutual followers are shielded automatically. Rate-limit guardrails
              prevent rapid bulk spikes.
            </p>
          </div>
          <div className="row-flex">
            <span className={`pill ${remainingToday === 0 ? 'pill-danger' : 'pill-info'}`}>
              24h Safety Quota: {usedToday} / {safetyConfig.maxPer24Hours} used
            </span>
          </div>
        </div>

        <div className="grid-3">
          <div className="card-subtle stack-sm">
            <label className="muted" style={{ fontSize: '0.78rem' }}>
              Humanized Delay Range (seconds)
            </label>
            <div className="row-flex">
              <input
                type="number"
                className="input"
                style={{ width: 76 }}
                min={5}
                max={120}
                value={safetyConfig.minDelaySec}
                onChange={(e) => onUpdateSafetyConfig({ minDelaySec: Number(e.target.value) || 15 })}
              />
              <span>to</span>
              <input
                type="number"
                className="input"
                style={{ width: 76 }}
                min={10}
                max={180}
                value={safetyConfig.maxDelaySec}
                onChange={(e) => onUpdateSafetyConfig({ maxDelaySec: Number(e.target.value) || 35 })}
              />
            </div>
          </div>

          <div className="card-subtle stack-sm">
            <label className="muted" style={{ fontSize: '0.78rem' }}>
              Batch Cap / 24h Rolling Cap
            </label>
            <div className="row-flex">
              <input
                type="number"
                className="input"
                style={{ width: 76 }}
                min={1}
                max={100}
                value={safetyConfig.maxPerBatch}
                onChange={(e) => onUpdateSafetyConfig({ maxPerBatch: Number(e.target.value) || 15 })}
              />
              <span>batch /</span>
              <input
                type="number"
                className="input"
                style={{ width: 76 }}
                min={5}
                max={200}
                value={safetyConfig.maxPer24Hours}
                onChange={(e) => onUpdateSafetyConfig({ maxPer24Hours: Number(e.target.value) || 50 })}
              />
              <span>24h</span>
            </div>
          </div>

          <div className="card-subtle stack-sm">
            <label className="row-flex" style={{ fontSize: '0.82rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={safetyConfig.verifyBeforeUnfollow}
                onChange={(e) => onUpdateSafetyConfig({ verifyBeforeUnfollow: e.target.checked })}
              />
              Pre-flight live verify before unfollow
            </label>
            <label className="row-flex" style={{ fontSize: '0.82rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={safetyConfig.useDomFallback}
                onChange={(e) => onUpdateSafetyConfig({ useDomFallback: e.target.checked })}
              />
              Enable real-DOM button click fallback
            </label>
          </div>
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="card stack-md">
        <div className="space-between">
          <div className="row-flex">
            <button
              type="button"
              className={`btn ${cockpitMode === 'automated' ? 'btn-primary' : ''}`}
              onClick={() => setCockpitMode('automated')}
            >
              Automated Paced Runner
            </button>
            <button
              type="button"
              className={`btn ${cockpitMode === 'guided' ? 'btn-cyan' : ''}`}
              onClick={() => setCockpitMode('guided')}
            >
              Guided Keyboard Cockpit (Zero-Install)
            </button>
          </div>

          <div className="row-flex">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => onPopulateQueueFromNonFollowers(true)}
            >
              Load Live-Confirmed Only
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => onPopulateQueueFromNonFollowers(false)}
            >
              Load All Actionable Non-Followers
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={onClearQueue}
              disabled={queueAccounts.length === 0 || runnerState === 'running'}
            >
              <Trash2 size={13} /> Clear Queue
            </button>
          </div>
        </div>

        {cockpitMode === 'automated' ? (
          <div className="card-subtle stack-sm">
            <div className="space-between">
              <div className="row-flex">
                <strong>Transport:</strong>
                <select
                  className="select"
                  value={preferredTransport}
                  onChange={(e) => setPreferredTransport(e.target.value as 'extension' | 'companion')}
                >
                  <option value="extension">
                    Browser Extension {extAuthenticated ? '(Ready)' : '(Not Connected)'}
                  </option>
                  <option value="companion">
                    Playwright Companion {companionAuthenticated ? '(Ready)' : '(Not Connected)'}
                  </option>
                </select>
                <span className="muted" style={{ fontSize: '0.84rem' }}>
                  Queue: <strong>{queueAccounts.length}</strong> accounts
                </span>
              </div>

              <div className="row-flex">
                {runnerState !== 'running' ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={
                      queueAccounts.length === 0 ||
                      remainingToday === 0 ||
                      (!extAuthenticated && !companionAuthenticated)
                    }
                    onClick={startAutomatedRunner}
                  >
                    <Play size={15} /> Start Paced Unfollow Batch
                  </button>
                ) : (
                  <button type="button" className="btn btn-danger" onClick={stopAutomatedRunner}>
                    <Square size={15} /> Emergency Pause / Stop
                  </button>
                )}
              </div>
            </div>

            {!extAuthenticated && !companionAuthenticated && (
              <div className="banner banner-warning" style={{ marginBottom: 0 }}>
                <div className="row-flex">
                  <AlertTriangle size={16} />
                  <span>
                    No automated transport connected yet. Connect the Extension / Companion in{' '}
                    <strong>Fact-Check</strong>, or switch to{' '}
                    <strong>Guided Keyboard Cockpit</strong> right here with zero installs!
                  </span>
                </div>
              </div>
            )}

            <div className="row-flex" style={{ fontSize: '0.86rem' }}>
              {runnerState === 'running' ? <Pause size={14} /> : <CheckCircle2 size={14} />}
              <span>{runnerMessage}</span>
              {countdownSec !== null && <span className="pill pill-info">{countdownSec}s</span>}
            </div>
          </div>
        ) : (
          <div className="card-subtle stack-md">
            {currentGuided ? (
              <>
                <div className="space-between">
                  <div>
                    <div className="muted" style={{ fontSize: '0.78rem' }}>
                      Guided Target {safeGuidedIndex + 1} of {queueAccounts.length}
                    </div>
                    <h3 style={{ margin: '2px 0' }}>
                      @{currentGuided.username}{' '}
                      <VerificationBadge status={currentGuided.verificationStatus} />
                    </h3>
                    {currentGuided.displayName && (
                      <div className="muted">{currentGuided.displayName}</div>
                    )}
                  </div>

                  <div className="row-flex">
                    <button
                      type="button"
                      className="btn btn-cyan"
                      onClick={() => openSideProfileWindow(currentGuided)}
                    >
                      <ExternalLink size={15} /> Open / Reuse Side Window (<span className="kbd">O</span>)
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => onGuidedMarkUnfollowed(currentGuided.username)}
                    >
                      <UserMinus size={15} /> Mark Unfollowed & Next (<span className="kbd">U</span>)
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => onGuidedWhitelistAndNext(currentGuided.username)}
                    >
                      <Shield size={15} /> Whitelist & Next (<span className="kbd">W</span>)
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        setGuidedIndex((i) => Math.min(queueAccounts.length - 1, i + 1))
                      }
                    >
                      <SkipForward size={15} /> Skip (<span className="kbd">S</span>)
                    </button>
                  </div>
                </div>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  Shortcuts: <span className="kbd">O</span> Open reusable side window ·{' '}
                  <span className="kbd">U</span> Mark unfollowed · <span className="kbd">W</span>{' '}
                  Keep/Whitelist · <span className="kbd">J</span>/<span className="kbd">K</span> Next/Prev
                </div>
              </>
            ) : (
              <div className="muted">
                Unfollow queue is empty. Click "Load All Actionable Non-Followers" above or select
                accounts in Audit Explorer.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Queue + Audit Log */}
      <div className="grid-2">
        <div className="card stack-sm">
          <div className="space-between">
            <strong>Active Unfollow Queue ({queueAccounts.length})</strong>
          </div>
          <div className="table-wrap" style={{ maxHeight: 340 }}>
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Status</th>
                  <th>Remove</th>
                </tr>
              </thead>
              <tbody>
                {queueAccounts.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">No accounts queued.</td>
                  </tr>
                ) : (
                  queueAccounts.map((acc) => (
                    <tr key={acc.username}>
                      <td>
                        <a href={acc.profileUrl} target="_blank" rel="noreferrer">
                          @{acc.username}
                        </a>
                      </td>
                      <td>
                        <VerificationBadge status={acc.verificationStatus} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => onRemoveFromQueue(acc.username)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card stack-sm">
          <div className="space-between">
            <strong>Unfollow Audit Ledger ({auditLog.length})</strong>
            <button
              type="button"
              className="btn btn-sm"
              disabled={auditLog.length === 0}
              onClick={() =>
                downloadTextFile(
                  'ig-unfollow-audit-log.json',
                  JSON.stringify(auditLog, null, 2),
                  'application/json',
                )
              }
            >
              <Download size={13} /> Export Log
            </button>
          </div>
          <div className="table-wrap" style={{ maxHeight: 340 }}>
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Method</th>
                  <th>Outcome</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">No unfollow actions recorded yet.</td>
                  </tr>
                ) : (
                  auditLog.slice(0, 100).map((entry) => (
                    <tr key={entry.id}>
                      <td>@{entry.username}</td>
                      <td><code className="mono" style={{ fontSize: '0.76rem' }}>{entry.method}</code></td>
                      <td>
                        <span
                          className={`pill ${
                            entry.status === 'success'
                              ? 'pill-success'
                              : entry.status === 'skipped'
                                ? 'pill-warning'
                                : 'pill-danger'
                          }`}
                        >
                          {entry.status}
                        </span>
                        {entry.error && (
                          <div className="muted" style={{ fontSize: '0.73rem' }}>
                            {entry.error}
                          </div>
                        )}
                      </td>
                      <td className="muted">{formatRelativeAge(entry.timestamp)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
