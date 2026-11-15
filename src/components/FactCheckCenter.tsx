import { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Plug,
  RefreshCw,
  Square,
  Terminal,
  Upload,
  Zap,
} from 'lucide-react';
import { buildDevToolsSyncSnippet, parseDevToolsImport } from '../core/transports/devToolsScript';
import type { TransportProgress, TransportSessionStatus } from '../core/transports/types';
import type {
  AccountSegment,
  EnrichedAccount,
  LiveGraphPayload,
  LiveProbeResult,
  ReconciledSummary,
} from '../core/types';
import { formatRelativeAge } from './shared';

interface FactCheckCenterProps {
  accounts: EnrichedAccount[];
  reconciliation: ReconciledSummary;
  liveGraph: LiveGraphPayload | null;
  extStatus: TransportSessionStatus;
  companionStatus: TransportSessionStatus;
  companionUrl: string;
  companionToken: string;
  onChangeCompanionConfig: (url: string, token: string) => void;
  onPingTransports: () => Promise<void>;
  onOpenCompanionLogin: () => Promise<void>;
  onRunSyncGraph: (via: 'extension' | 'companion') => Promise<void>;
  onRunFactCheckNonFollowers: (via: 'extension' | 'companion', limit: number) => Promise<void>;
  onAbortLiveJob: (via: 'extension' | 'companion') => Promise<void>;
  liveJobProgress: TransportProgress | null;
  onImportDevToolsJson: (
    result:
      | { type: 'live_graph'; payload: LiveGraphPayload }
      | { type: 'probes'; probes: LiveProbeResult[] },
  ) => void;
  onSimulateLiveDrift?: () => Promise<void>;
  onNavigateSegment: (seg: AccountSegment) => void;
  onQueueConfirmedNonMutuals: () => void;
}

export function FactCheckCenter({
  accounts,
  reconciliation,
  liveGraph,
  extStatus,
  companionStatus,
  companionUrl,
  companionToken,
  onChangeCompanionConfig,
  onPingTransports,
  onOpenCompanionLogin,
  onRunSyncGraph,
  onRunFactCheckNonFollowers,
  onAbortLiveJob,
  liveJobProgress,
  onImportDevToolsJson,
  onSimulateLiveDrift,
  onNavigateSegment,
  onQueueConfirmedNonMutuals,
}: FactCheckCenterProps) {
  const [devMode, setDevMode] = useState<'targeted_probe' | 'full_graph'>('targeted_probe');
  const [batchLimit, setBatchLimit] = useState(50);
  const [copied, setCopied] = useState(false);
  const [pasteJson, setPasteJson] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  const nonFollowers = accounts.filter(
    (a) => a.isNotFollowingBack && a.unfollowState !== 'unfollowed',
  );
  const targetHandles = nonFollowers
    .filter((a) => !a.whitelisted && !a.protectedByRule)
    .slice(0, 100)
    .map((a) => a.username);

  const snippet = buildDevToolsSyncSnippet({
    mode: devMode,
    targetUsernames: targetHandles,
    delayMs: 1200,
  });

  async function copySnippet() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleImportPasted() {
    setImportError(null);
    setImportSuccess(null);
    try {
      const parsed = parseDevToolsImport(pasteJson);
      onImportDevToolsJson(parsed);
      setImportSuccess(
        parsed.type === 'live_graph'
          ? `Imported live graph (${parsed.payload.followers.length} followers, ${parsed.payload.following.length} following) and reconciled against export!`
          : `Imported ${parsed.probes.length} targeted live account checks and reconciled against export!`,
      );
      setPasteJson('');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  }

  const isRunning =
    liveJobProgress &&
    liveJobProgress.phase !== 'done' &&
    liveJobProgress.phase !== 'aborted' &&
    liveJobProgress.phase !== 'paused';

  return (
    <div className="stack-md">
      <div className="card stack-sm">
        <div className="space-between">
          <div>
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>
              Automated Fact-Checking & Stale Export Reconciliation
            </h2>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.88rem' }}>
              Instagram data downloads can quickly become outdated. Verify your export against live
              Instagram state so you catch accounts you already unfollowed, accounts that followed you back,
              or deactivated profiles before taking action.
            </p>
          </div>
          {onSimulateLiveDrift && (
            <button type="button" className="btn btn-sm" onClick={onSimulateLiveDrift}>
              Apply Demo Live Drift
            </button>
          )}
        </div>

        <div className="grid-3" style={{ marginTop: 6 }}>
          <button
            type="button"
            className="card-subtle"
            style={{ textAlign: 'left', cursor: 'pointer' }}
            onClick={() => onNavigateSegment('confirmed_non_mutual')}
          >
            <div className="muted" style={{ fontSize: '0.76rem' }}>Confirmed Non-Mutuals</div>
            <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--accent)' }}>
              {reconciliation.confirmedNotFollowingBack}
            </div>
            <div className="muted" style={{ fontSize: '0.76rem' }}>Safe & verified to unfollow</div>
          </button>

          <button
            type="button"
            className="card-subtle"
            style={{ textAlign: 'left', cursor: 'pointer' }}
            onClick={() => onNavigateSegment('stale_already_unfollowed')}
          >
            <div className="muted" style={{ fontSize: '0.76rem' }}>Stale False Positives Cleared</div>
            <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--success)' }}>
              {reconciliation.alreadyUnfollowed + reconciliation.nowFollowsBack}
            </div>
            <div className="muted" style={{ fontSize: '0.76rem' }}>
              {reconciliation.alreadyUnfollowed} already unfollowed · {reconciliation.nowFollowsBack} now mutual
            </div>
          </button>

          <button
            type="button"
            className="card-subtle"
            style={{ textAlign: 'left', cursor: 'pointer' }}
            onClick={() => onNavigateSegment('deactivated_missing')}
          >
            <div className="muted" style={{ fontSize: '0.76rem' }}>Deactivated / Missing</div>
            <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--warning)' }}>
              {reconciliation.deactivatedOrMissing}
            </div>
            <div className="muted" style={{ fontSize: '0.76rem' }}>
              {liveGraph ? `Last full sync ${formatRelativeAge(liveGraph.capturedAt)}` : `${reconciliation.unverified} unverified`}
            </div>
          </button>
        </div>

        {reconciliation.confirmedNotFollowingBack > 0 && (
          <div className="row-flex">
            <button type="button" className="btn btn-primary btn-sm" onClick={onQueueConfirmedNonMutuals}>
              Queue All {reconciliation.confirmedNotFollowingBack} Confirmed Non-Mutuals
            </button>
          </div>
        )}
      </div>

      {liveJobProgress && (
        <div className="banner banner-info">
          <div className="row-flex">
            <Zap size={16} />
            <span>
              <strong>{liveJobProgress.phase.toUpperCase()}:</strong> {liveJobProgress.message}
              {liveJobProgress.total ? ` (${liveJobProgress.current}/${liveJobProgress.total})` : ''}
            </span>
          </div>
          {isRunning && (
            <div className="row-flex">
              {extStatus.connected && (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => onAbortLiveJob('extension')}
                >
                  <Square size={13} /> Stop Extension Job
                </button>
              )}
              {companionStatus.connected && (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => onAbortLiveJob('companion')}
                >
                  <Square size={13} /> Stop Companion Job
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Three Live Transport Methods */}
      <div className="grid-2">
        {/* 1. Browser Extension */}
        <div className="card stack-sm">
          <div className="space-between">
            <strong>1. Browser Extension Bridge (Recommended)</strong>
            <span className={`pill ${extStatus.authenticated ? 'pill-success' : extStatus.connected ? 'pill-warning' : 'pill-neutral'}`}>
              {extStatus.authenticated
                ? `Connected @${extStatus.ownerUsername || extStatus.ownerUserId}`
                : extStatus.connected
                  ? 'Instagram Login Needed'
                  : 'Not Detected'}
            </span>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: '0.84rem' }}>
            Uses your active Chrome/Edge Instagram tab session securely without sharing passwords or
            exposing <code className="mono">sessionid</code> cookies to web pages.
          </p>

          <div className="row-flex">
            <label className="muted" style={{ fontSize: '0.82rem' }}>Probe batch limit:</label>
            <input
              type="number"
              className="input"
              style={{ width: 90 }}
              min={5}
              max={250}
              value={batchLimit}
              onChange={(e) => setBatchLimit(Number(e.target.value) || 50)}
            />
          </div>

          <div className="row-flex">
            <button
              type="button"
              className="btn btn-cyan btn-sm"
              disabled={!extStatus.authenticated || Boolean(isRunning)}
              onClick={() => onRunFactCheckNonFollowers('extension', batchLimit)}
            >
              <Zap size={14} /> Fact-Check Top {batchLimit} Non-Followers
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!extStatus.authenticated || Boolean(isRunning)}
              onClick={() => onRunSyncGraph('extension')}
            >
              <RefreshCw size={14} /> Full Live Graph Sync
            </button>
            <a
              href="./downloads/ig-auditor-extension.zip"
              download="ig-auditor-extension.zip"
              className="btn btn-sm"
            >
              <Download size={14} /> Download Extension ZIP
            </a>
          </div>
        </div>

        {/* 2. Local Playwright Companion */}
        <div className="card stack-sm">
          <div className="space-between">
            <strong>2. Local Playwright Companion Bridge</strong>
            <span className={`pill ${companionStatus.authenticated ? 'pill-success' : companionStatus.connected ? 'pill-warning' : 'pill-neutral'}`}>
              {companionStatus.authenticated
                ? `Ready @${companionStatus.ownerUsername || companionStatus.ownerUserId}`
                : companionStatus.connected
                  ? 'Login Required'
                  : 'Offline'}
            </span>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: '0.84rem' }}>
            Runs locally via Node.js + Chromium (<code className="mono">cd companion && npm run serve</code>)
            with persistent session & real DOM verification fallback.
          </p>

          <div className="grid-2" style={{ gap: 8 }}>
            <input
              type="text"
              className="input"
              value={companionUrl}
              onChange={(e) => onChangeCompanionConfig(e.target.value, companionToken)}
              placeholder="http://127.0.0.1:47831"
              aria-label="Companion URL"
            />
            <input
              type="password"
              className="input"
              value={companionToken}
              onChange={(e) => onChangeCompanionConfig(companionUrl, e.target.value)}
              placeholder="Paste X-Auditor-Token"
              aria-label="Companion Pairing Token"
            />
          </div>

          <div className="row-flex">
            <button type="button" className="btn btn-sm" onClick={onPingTransports}>
              <Plug size={14} /> Test / Pair Connection
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!companionStatus.connected}
              onClick={onOpenCompanionLogin}
            >
              Open Login Browser
            </button>
            <button
              type="button"
              className="btn btn-cyan btn-sm"
              disabled={!companionStatus.authenticated || Boolean(isRunning)}
              onClick={() => onRunFactCheckNonFollowers('companion', batchLimit)}
            >
              Fact-Check ({batchLimit})
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!companionStatus.authenticated || Boolean(isRunning)}
              onClick={() => onRunSyncGraph('companion')}
            >
              Full Sync
            </button>
          </div>
        </div>
      </div>

      {/* 3. Zero-Install DevTools Snippet */}
      <div className="card stack-sm">
        <div className="space-between">
          <div className="row-flex">
            <Terminal size={18} style={{ color: 'var(--accent-2)' }} />
            <strong>3. Zero-Install DevTools Live-Sync (No Extension or Node Needed)</strong>
          </div>
          <div className="row-flex">
            <select
              className="select"
              value={devMode}
              onChange={(e) => setDevMode(e.target.value as 'targeted_probe' | 'full_graph')}
              aria-label="DevTools script mode"
            >
              <option value="targeted_probe">
                Verify Unprotected Non-Followers ({targetHandles.length} handles)
              </option>
              <option value="full_graph">Full Live Followers + Following Sync</option>
            </select>
            <button type="button" className="btn btn-cyan btn-sm" onClick={copySnippet}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied!' : 'Copy Console Script'}
            </button>
          </div>
        </div>

        <pre className="pre-code">{snippet}</pre>

        <div className="stack-sm">
          <label className="muted" style={{ fontSize: '0.84rem' }}>
            Paste JSON output copied from your Instagram DevTools console (or CLI <code className="mono">fact-check-report.json</code>):
          </label>
          <textarea
            className="textarea mono"
            rows={4}
            placeholder='{"kind":"ig_auditor_probes","probes":[...]} or {"kind":"ig_auditor_live_graph",...}'
            value={pasteJson}
            onChange={(e) => setPasteJson(e.target.value)}
          />
          <div className="row-flex">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!pasteJson.trim()}
              onClick={handleImportPasted}
            >
              <Upload size={14} /> Reconcile Pasted Live JSON
            </button>
          </div>
          {importError && <div className="banner banner-danger">{importError}</div>}
          {importSuccess && <div className="banner banner-success">{importSuccess}</div>}
        </div>
      </div>
    </div>
  );
}
