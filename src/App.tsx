import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  FolderPlus,
  GitCompare,
  Layers,
  LayoutDashboard,
  Moon,
  ShieldCheck,
  Sun,
  UserMinus,
  Users,
} from 'lucide-react';
import { AccountDrawer } from './components/AccountDrawer';
import { AccountsWorkspace } from './components/AccountsWorkspace';
import { DropzoneIngest } from './components/DropzoneIngest';
import { FactCheckCenter } from './components/FactCheckCenter';
import { ModulesExtensions } from './components/ModulesExtensions';
import { OverviewDashboard } from './components/OverviewDashboard';
import { SnapshotCompare } from './components/SnapshotCompare';
import { UnfollowCockpit } from './components/UnfollowCockpit';
import { downloadTextFile } from './components/shared';
import { ensureBuiltinParsersRegistered } from './core/parsers/ingestEngine';
import { ensureBuiltinAnalyzersRegistered } from './core/plugins/builtinAnalyzers';
import { defaultPluginRegistry } from './core/plugins/registry';
import {
  buildEnrichedAccounts,
  summarizeReconciliation,
} from './core/reconciliation/engine';
import { isAccountEligibleForQueue } from './core/reconciliation/safetyRules';
import { createDemoScenario } from './core/sampleData';
import {
  clearWorkspaceState,
  createInitialWorkspaceState,
  loadWorkspaceState,
  saveWorkspaceState,
  type WorkspaceState,
} from './core/storage/db';
import { CompanionTransport } from './core/transports/companionTransport';
import { ExtensionTransport } from './core/transports/extensionTransport';
import type { TransportProgress, TransportSessionStatus } from './core/transports/types';
import type {
  AccountMetadata,
  AccountSegment,
  ExportSnapshot,
  LiveGraphPayload,
  LiveProbeResult,
  SafetyConfig,
  SmartProtectionConfig,
  UnfollowAuditEntry,
  WorkspaceTabId,
} from './core/types';

ensureBuiltinParsersRegistered();
ensureBuiltinAnalyzersRegistered();

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(() =>
    createInitialWorkspaceState(),
  );
  const [hydrated, setHydrated] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkspaceTabId>('overview');
  const [activeSegment, setActiveSegment] = useState<AccountSegment>('not_following_back');
  const [showImporter, setShowImporter] = useState(false);
  const [drawerUsername, setDrawerUsername] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [companionUrl, setCompanionUrl] = useState(
    () => localStorage.getItem('ig_auditor_companion_url') || 'http://127.0.0.1:47831',
  );
  const [companionToken, setCompanionToken] = useState(
    () => localStorage.getItem('ig_auditor_companion_token') || '',
  );

  const extTransportRef = useRef(new ExtensionTransport());
  const companionTransportRef = useRef(new CompanionTransport(companionUrl, companionToken));

  const [extStatus, setExtStatus] = useState<TransportSessionStatus>({
    connected: false,
    authenticated: false,
    transportName: 'Browser Extension (MV3)',
  });
  const [companionStatus, setCompanionStatus] = useState<TransportSessionStatus>({
    connected: false,
    authenticated: false,
    transportName: 'Local Playwright Companion',
  });
  const [liveJobProgress, setLiveJobProgress] = useState<TransportProgress | null>(null);
  const [demoLiveCache, setDemoLiveCache] = useState<{
    graph: LiveGraphPayload;
    probes: Record<string, LiveProbeResult>;
  } | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((curr) => (curr === msg ? null : curr));
    }, 4500);
  }, []);

  const pingTransports = useCallback(async () => {
    const [ext, comp] = await Promise.all([
      extTransportRef.current.ping(),
      companionTransportRef.current.ping(),
    ]);
    setExtStatus(ext);
    setCompanionStatus(comp);
  }, []);

  useEffect(() => {
    void loadWorkspaceState().then((loaded) => {
      for (const id of loaded.disabledAnalyzers) {
        defaultPluginRegistry.setAnalyzerEnabled(id, false);
      }
      setWorkspace(loaded);
      setHydrated(true);
    });
    void pingTransports();
  }, [pingTransports]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', workspace.theme);
  }, [workspace.theme]);

  useEffect(() => {
    if (!hydrated) return;
    void saveWorkspaceState(workspace);
  }, [workspace, hydrated]);

  const activeSnapshot = useMemo(
    () =>
      workspace.snapshots.find((s) => s.id === workspace.activeSnapshotId) ??
      workspace.snapshots[workspace.snapshots.length - 1] ??
      null,
    [workspace.snapshots, workspace.activeSnapshotId],
  );

  const accounts = useMemo(() => {
    if (!activeSnapshot) return [];
    return buildEnrichedAccounts({
      snapshot: activeSnapshot,
      liveGraph: workspace.liveGraph,
      liveProbes: workspace.liveProbes,
      metadataMap: workspace.metadataMap,
      protectionConfig: workspace.protectionConfig,
    });
  }, [
    activeSnapshot,
    workspace.liveGraph,
    workspace.liveProbes,
    workspace.metadataMap,
    workspace.protectionConfig,
  ]);

  const accountsByUsername = useMemo(
    () => new Map(accounts.map((a) => [a.username, a])),
    [accounts],
  );

  const reconciliation = useMemo(() => summarizeReconciliation(accounts), [accounts]);

  const verificationCounts = useMemo(() => {
    const counts = {
      unverified: 0,
      verifying: 0,
      confirmed_not_following_back: 0,
      verified_mutual: 0,
      actually_follows_back: 0,
      already_unfollowed: 0,
      new_non_follower: 0,
      deactivated_or_missing: 0,
      handle_changed: 0,
      rate_limited: 0,
      error: 0,
    };
    for (const acc of accounts) {
      counts[acc.verificationStatus] += 1;
    }
    return counts;
  }, [accounts]);

  const insights = useMemo(() => {
    if (!activeSnapshot) return [];
    return defaultPluginRegistry.runAnalyzers({
      snapshot: activeSnapshot,
      accounts,
      protectionConfig: workspace.protectionConfig,
      safetyConfig: workspace.safetyConfig,
      actionsLast24h: workspace.auditLog.filter(
        (e) => e.status === 'success' && e.timestamp >= Date.now() - 86_400_000,
      ).length,
      verificationCounts,
    });
  }, [
    activeSnapshot,
    accounts,
    workspace.protectionConfig,
    workspace.safetyConfig,
    workspace.auditLog,
    workspace.disabledAnalyzers,
    verificationCounts,
  ]);

  function handleSnapshotImported(snapshot: ExportSnapshot) {
    setWorkspace((prev) => ({
      ...prev,
      snapshots: [...prev.snapshots, snapshot],
      activeSnapshotId: snapshot.id,
    }));
    setShowImporter(false);
    setActiveTab('overview');
    notify(
      `Imported "${snapshot.label}": ${snapshot.datasets.following.length} following, ${snapshot.datasets.followers.length} followers.`,
    );
  }

  async function handleLoadDemo() {
    const demo = await createDemoScenario();
    setDemoLiveCache({
      graph: demo.simulatedLiveGraph,
      probes: demo.simulatedProbes,
    });
    setWorkspace((prev) => ({
      ...prev,
      snapshots: [...prev.snapshots, demo.olderSnapshot, demo.snapshot],
      activeSnapshotId: demo.snapshot.id,
      liveGraph: null,
      liveProbes: {},
    }));
    setShowImporter(false);
    setActiveTab('overview');
    notify('Loaded realistic 35-day-old HTML+JSON demo export (+ 90-day-old baseline for diffing).');
  }

  async function handleApplyDemoLiveDrift() {
    if (!demoLiveCache) return;
    setWorkspace((prev) => ({
      ...prev,
      liveGraph: demoLiveCache.graph,
      liveProbes: { ...prev.liveProbes, ...demoLiveCache.probes },
    }));
    notify('Simulated live reality applied! Stale unfollows, new mutuals & deactivated profiles reconciled.');
  }

  function updateMetadata(username: string, patch: Partial<AccountMetadata>) {
    setWorkspace((prev) => {
      const existing: AccountMetadata = prev.metadataMap[username] ?? {
        username,
        whitelisted: false,
        tags: [],
        note: '',
        unfollowState: 'none',
        updatedAt: Date.now(),
      };
      return {
        ...prev,
        metadataMap: {
          ...prev.metadataMap,
          [username]: {
            ...existing,
            ...patch,
            username,
            updatedAt: Date.now(),
          },
        },
      };
    });
  }

  function handleToggleWhitelist(usernames: string[], whitelisted: boolean, reason?: string) {
    setWorkspace((prev) => {
      const nextMap = { ...prev.metadataMap };
      for (const u of usernames) {
        const cur = nextMap[u] ?? {
          username: u,
          whitelisted: false,
          tags: [],
          note: '',
          unfollowState: 'none',
          updatedAt: Date.now(),
        };
        nextMap[u] = {
          ...cur,
          whitelisted,
          whitelistReason: whitelisted ? reason || cur.whitelistReason || 'Whitelisted' : '',
          updatedAt: Date.now(),
        };
      }
      const nextQueue = whitelisted
        ? prev.unfollowQueue.filter((q) => !usernames.includes(q))
        : prev.unfollowQueue;
      return { ...prev, metadataMap: nextMap, unfollowQueue: nextQueue };
    });
    notify(
      whitelisted
        ? `Protected ${usernames.length} account(s) on Safe List.`
        : `Removed Safe List protection from ${usernames.length} account(s).`,
    );
  }

  function handleQueueUsernames(usernames: string[]) {
    let added = 0;
    let skippedProtected = 0;
    setWorkspace((prev) => {
      const queueSet = new Set(prev.unfollowQueue);
      for (const u of usernames) {
        const acc = accountsByUsername.get(u);
        if (!acc || !isAccountEligibleForQueue(acc, prev.metadataMap)) {
          skippedProtected += 1;
          continue;
        }
        if (!queueSet.has(u)) {
          queueSet.add(u);
          added += 1;
        }
      }
      return { ...prev, unfollowQueue: Array.from(queueSet) };
    });
    notify(
      `Queued ${added} account(s)${skippedProtected > 0 ? ` (skipped ${skippedProtected} protected/ineligible)` : ''}.`,
    );
  }

  function handlePopulateQueue(confirmedOnly: boolean) {
    const candidates = accounts
      .filter((a) => {
        if (!isAccountEligibleForQueue(a, workspace.metadataMap)) return false;
        return confirmedOnly ? a.verificationStatus === 'confirmed_not_following_back' : true;
      })
      .map((a) => a.username);
    handleQueueUsernames(candidates);
    setActiveTab('unfollow');
  }

  function getTransport(via: 'extension' | 'companion') {
    return via === 'extension' ? extTransportRef.current : companionTransportRef.current;
  }

  async function handleRunSyncGraph(via: 'extension' | 'companion') {
    const transport = getTransport(via);
    try {
      const payload = await transport.syncLiveGraph((progress) => setLiveJobProgress(progress));
      setWorkspace((prev) => ({ ...prev, liveGraph: payload }));
      notify(
        `Live sync complete: ${payload.followers.length} followers, ${payload.following.length} following.`,
      );
    } catch (err) {
      notify(`Live sync failed: ${err instanceof Error ? err.message : String(err)}`);
      setLiveJobProgress(null);
    }
  }

  async function handleRunFactCheck(usernames: string[], via: 'extension' | 'companion') {
    const transport = getTransport(via);
    const targets = usernames.map((u) => ({
      username: u,
      userId: accountsByUsername.get(u)?.userId,
    }));

    try {
      const probes = await transport.factCheckAccounts(targets, (progress, latest) => {
        setLiveJobProgress(progress);
        if (latest) {
          setWorkspace((prev) => ({
            ...prev,
            liveProbes: { ...prev.liveProbes, [latest.username]: latest },
          }));
        }
      });
      notify(`Fact-checked ${probes.length} account(s) against live Instagram.`);
    } catch (err) {
      notify(`Fact-check error: ${err instanceof Error ? err.message : String(err)}`);
      setLiveJobProgress(null);
    }
  }

  async function handleRunFactCheckNonFollowers(via: 'extension' | 'companion', limit: number) {
    const targets = accounts
      .filter(
        (a) =>
          a.isNotFollowingBack &&
          a.unfollowState !== 'unfollowed' &&
          !a.whitelisted &&
          !a.protectedByRule,
      )
      .slice(0, limit)
      .map((a) => a.username);
    if (targets.length === 0) {
      notify('No actionable unverified non-followers to fact-check.');
      return;
    }
    await handleRunFactCheck(targets, via);
  }

  async function handleExecuteAutomatedUnfollow(
    username: string,
    via: 'extension' | 'companion',
  ): Promise<{ ok: boolean; rateLimited?: boolean; error?: string }> {
    const acc = accountsByUsername.get(username);
    const transport = getTransport(via);
    const res = await transport.unfollowAccount(
      { username, userId: acc?.userId },
      workspace.safetyConfig,
    );

    const logEntry: UnfollowAuditEntry = {
      id: `unf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      username,
      timestamp: Date.now(),
      method: res.methodUsed,
      verifiedAfter: res.verifiedFollowing === false,
      status: res.ok ? 'success' : res.error?.includes('follows you back') ? 'skipped' : 'failed',
      error: res.error,
      snapshotId: activeSnapshot?.id,
    };

    setWorkspace((prev) => {
      const curMeta = prev.metadataMap[username] ?? {
        username,
        whitelisted: false,
        tags: [],
        note: '',
        unfollowState: 'none',
        updatedAt: Date.now(),
      };
      return {
        ...prev,
        auditLog: [logEntry, ...prev.auditLog],
        unfollowQueue: res.ok ? prev.unfollowQueue.filter((q) => q !== username) : prev.unfollowQueue,
        metadataMap: {
          ...prev.metadataMap,
          [username]: {
            ...curMeta,
            unfollowState: res.ok ? 'unfollowed' : 'failed',
            unfollowedAt: res.ok ? Date.now() : curMeta.unfollowedAt,
            updatedAt: Date.now(),
          },
        },
      };
    });

    return { ok: res.ok, rateLimited: res.rateLimited, error: res.error };
  }

  function handleGuidedMarkUnfollowed(username: string) {
    const logEntry: UnfollowAuditEntry = {
      id: `unf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      username,
      timestamp: Date.now(),
      method: 'guided_manual',
      status: 'success',
      snapshotId: activeSnapshot?.id,
    };
    setWorkspace((prev) => {
      const curMeta = prev.metadataMap[username] ?? {
        username,
        whitelisted: false,
        tags: [],
        note: '',
        unfollowState: 'none',
        updatedAt: Date.now(),
      };
      return {
        ...prev,
        auditLog: [logEntry, ...prev.auditLog],
        unfollowQueue: prev.unfollowQueue.filter((q) => q !== username),
        metadataMap: {
          ...prev.metadataMap,
          [username]: {
            ...curMeta,
            unfollowState: 'unfollowed',
            unfollowedAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      };
    });
  }

  function handleImportDevToolsJson(
    result:
      | { type: 'live_graph'; payload: LiveGraphPayload }
      | { type: 'probes'; probes: LiveProbeResult[] },
  ) {
    if (result.type === 'live_graph') {
      setWorkspace((prev) => ({ ...prev, liveGraph: result.payload }));
    } else {
      setWorkspace((prev) => {
        const nextProbes = { ...prev.liveProbes };
        for (const p of result.probes) {
          nextProbes[p.username] = p;
        }
        return { ...prev, liveProbes: nextProbes };
      });
    }
  }

  function handlePromoteLiveGraphToSnapshot() {
    if (!workspace.liveGraph) return;
    const g = workspace.liveGraph;
    const snap: ExportSnapshot = {
      id: `snap_live_${Date.now()}`,
      label: `Live Sync (${g.ownerUsername ? `@${g.ownerUsername}` : 'Session'})`,
      createdAt: Date.now(),
      exportGeneratedAt: g.capturedAt,
      ownerUsername: g.ownerUsername,
      sourceFormat: 'live-sync',
      sourceKind: 'live_sync',
      filesScanned: [
        {
          path: `live-sync://${g.source}`,
          name: 'live-sync.json',
          format: 'json',
          category: 'followers',
          entriesExtracted: g.followers.length + g.following.length,
        },
      ],
      skippedFilesCount: 0,
      warnings: [],
      datasets: {
        followers: g.followers,
        following: g.following,
        pending_requests: [],
        recent_requests: [],
        recently_unfollowed: [],
        close_friends: [],
        favorites: [],
        blocked: [],
        restricted: [],
        unknown: [],
      },
    };
    setWorkspace((prev) => ({ ...prev, snapshots: [...prev.snapshots, snap] }));
    notify('Saved current Live Sync as a permanent historical snapshot for timeline diffing.');
  }

  const drawerAccount = drawerUsername ? accountsByUsername.get(drawerUsername) ?? null : null;
  const canLiveVerify = extStatus.authenticated || companionStatus.authenticated;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">IG</div>
          <div>
            <h1 className="brand-title">IG Relationship Auditor</h1>
            <div className="brand-sub">
              Client-Side Export Analyzer · Automated Fact-Checker · Safe Unfollow Studio
            </div>
          </div>
        </div>

        <div className="topbar-controls">
          {workspace.snapshots.length > 0 && (
            <select
              className="select"
              value={activeSnapshot?.id ?? ''}
              onChange={(e) =>
                setWorkspace((prev) => ({ ...prev, activeSnapshotId: e.target.value }))
              }
              aria-label="Active export snapshot"
            >
              {workspace.snapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.datasets.following.length} following)
                </option>
              ))}
            </select>
          )}

          <span
            className={`pill ${
              extStatus.authenticated || companionStatus.authenticated
                ? 'pill-success'
                : 'pill-neutral'
            }`}
          >
            <Activity size={13} />
            {extStatus.authenticated
              ? `Extension @${extStatus.ownerUsername || 'Ready'}`
              : companionStatus.authenticated
                ? `Companion @${companionStatus.ownerUsername || 'Ready'}`
                : 'Offline Export Mode'}
          </span>

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setShowImporter((v) => !v)}
          >
            <FolderPlus size={14} /> {showImporter ? 'Close Importer' : 'Import Export'}
          </button>

          <button
            type="button"
            className="btn btn-sm"
            aria-label="Toggle color theme"
            onClick={() =>
              setWorkspace((prev) => ({
                ...prev,
                theme: prev.theme === 'dark' ? 'light' : 'dark',
              }))
            }
          >
            {workspace.theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>

      {toast && (
        <div className="banner banner-info" role="status">
          <span>{toast}</span>
        </div>
      )}

      {(!activeSnapshot || showImporter) && (
        <div style={{ marginBottom: 18 }}>
          <DropzoneIngest
            onSnapshotImported={handleSnapshotImported}
            onLoadDemo={handleLoadDemo}
            compact={Boolean(activeSnapshot)}
          />
        </div>
      )}

      {activeSnapshot && (
        <>
          <nav className="nav-tabs" aria-label="Primary workspace navigation">
            <button
              type="button"
              className={`nav-tab ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              <LayoutDashboard size={15} /> Overview
            </button>
            <button
              type="button"
              className={`nav-tab ${activeTab === 'accounts' ? 'active' : ''}`}
              onClick={() => setActiveTab('accounts')}
            >
              <Users size={15} /> Audit Explorer
              <span className="nav-badge">
                {accounts.filter((a) => a.isNotFollowingBack && a.unfollowState !== 'unfollowed').length}
              </span>
            </button>
            <button
              type="button"
              className={`nav-tab ${activeTab === 'fact-check' ? 'active' : ''}`}
              onClick={() => setActiveTab('fact-check')}
            >
              <ShieldCheck size={15} /> Live Fact-Check
            </button>
            <button
              type="button"
              className={`nav-tab ${activeTab === 'unfollow' ? 'active' : ''}`}
              onClick={() => setActiveTab('unfollow')}
            >
              <UserMinus size={15} /> Unfollow Cockpit
              {workspace.unfollowQueue.length > 0 && (
                <span className="nav-badge">{workspace.unfollowQueue.length}</span>
              )}
            </button>
            <button
              type="button"
              className={`nav-tab ${activeTab === 'compare' ? 'active' : ''}`}
              onClick={() => setActiveTab('compare')}
            >
              <GitCompare size={15} /> Timeline Diff
            </button>
            <button
              type="button"
              className={`nav-tab ${activeTab === 'modules' ? 'active' : ''}`}
              onClick={() => setActiveTab('modules')}
            >
              <Layers size={15} /> Modules & Setup
            </button>
          </nav>

          {activeTab === 'overview' && (
            <OverviewDashboard
              snapshot={activeSnapshot}
              accounts={accounts}
              insights={insights}
              reconciliation={reconciliation}
              onNavigateSegment={(seg) => {
                setActiveSegment(seg);
                setActiveTab('accounts');
              }}
              onNavigateTab={setActiveTab}
              onQueueConfirmed={() => handlePopulateQueue(false)}
            />
          )}

          {activeTab === 'accounts' && (
            <AccountsWorkspace
              accounts={accounts}
              activeSegment={activeSegment}
              onChangeSegment={setActiveSegment}
              unfollowQueue={workspace.unfollowQueue}
              onQueueUsernames={handleQueueUsernames}
              onToggleWhitelist={handleToggleWhitelist}
              onLiveVerifyUsernames={(usernames) => {
                const via = extStatus.authenticated ? 'extension' : 'companion';
                void handleRunFactCheck(usernames, via);
              }}
              canLiveVerify={canLiveVerify}
              onSelectAccount={setDrawerUsername}
            />
          )}

          {activeTab === 'fact-check' && (
            <FactCheckCenter
              accounts={accounts}
              reconciliation={reconciliation}
              liveGraph={workspace.liveGraph}
              extStatus={extStatus}
              companionStatus={companionStatus}
              companionUrl={companionUrl}
              companionToken={companionToken}
              onChangeCompanionConfig={(url, tok) => {
                setCompanionUrl(url);
                setCompanionToken(tok);
                localStorage.setItem('ig_auditor_companion_url', url);
                localStorage.setItem('ig_auditor_companion_token', tok);
                companionTransportRef.current.configure(url, tok);
              }}
              onPingTransports={pingTransports}
              onOpenCompanionLogin={async () => {
                try {
                  const res = await companionTransportRef.current.openLoginBrowser();
                  notify(res.message || 'Opened Chromium login browser');
                } catch (err) {
                  notify(err instanceof Error ? err.message : String(err));
                }
              }}
              onRunSyncGraph={handleRunSyncGraph}
              onRunFactCheckNonFollowers={handleRunFactCheckNonFollowers}
              onAbortLiveJob={async (via) => {
                await getTransport(via).abort();
                setLiveJobProgress(null);
              }}
              liveJobProgress={liveJobProgress}
              onImportDevToolsJson={handleImportDevToolsJson}
              onSimulateLiveDrift={demoLiveCache ? handleApplyDemoLiveDrift : undefined}
              onNavigateSegment={(seg) => {
                setActiveSegment(seg);
                setActiveTab('accounts');
              }}
              onQueueConfirmedNonMutuals={() => handlePopulateQueue(true)}
            />
          )}

          {activeTab === 'unfollow' && (
            <UnfollowCockpit
              accountsByUsername={accountsByUsername}
              unfollowQueue={workspace.unfollowQueue}
              auditLog={workspace.auditLog}
              safetyConfig={workspace.safetyConfig}
              onUpdateSafetyConfig={(patch: Partial<SafetyConfig>) =>
                setWorkspace((prev) => ({
                  ...prev,
                  safetyConfig: { ...prev.safetyConfig, ...patch },
                }))
              }
              onRemoveFromQueue={(username) =>
                setWorkspace((prev) => ({
                  ...prev,
                  unfollowQueue: prev.unfollowQueue.filter((q) => q !== username),
                }))
              }
              onClearQueue={() => setWorkspace((prev) => ({ ...prev, unfollowQueue: [] }))}
              onPopulateQueueFromNonFollowers={handlePopulateQueue}
              onGuidedMarkUnfollowed={handleGuidedMarkUnfollowed}
              onGuidedWhitelistAndNext={(username) =>
                handleToggleWhitelist([username], true, 'Protected during Guided Review')
              }
              onExecuteAutomatedUnfollow={handleExecuteAutomatedUnfollow}
              extAuthenticated={extStatus.authenticated}
              companionAuthenticated={companionStatus.authenticated}
            />
          )}

          {activeTab === 'compare' && (
            <SnapshotCompare
              snapshots={workspace.snapshots}
              liveGraph={workspace.liveGraph}
              onPromoteLiveGraphToSnapshot={handlePromoteLiveGraphToSnapshot}
            />
          )}

          {activeTab === 'modules' && (
            <ModulesExtensions
              modules={defaultPluginRegistry.listDescriptors()}
              onToggleAnalyzer={(id, enabled) => {
                defaultPluginRegistry.setAnalyzerEnabled(id, enabled);
                setWorkspace((prev) => {
                  const set = new Set(prev.disabledAnalyzers);
                  if (enabled) set.delete(id);
                  else set.add(id);
                  return { ...prev, disabledAnalyzers: Array.from(set) };
                });
              }}
              protectionConfig={workspace.protectionConfig}
              onUpdateProtectionConfig={(patch: Partial<SmartProtectionConfig>) =>
                setWorkspace((prev) => ({
                  ...prev,
                  protectionConfig: { ...prev.protectionConfig, ...patch },
                }))
              }
              onExportWorkspaceBackup={() =>
                downloadTextFile(
                  `ig-auditor-backup-${new Date().toISOString().slice(0, 10)}.json`,
                  JSON.stringify(workspace, null, 2),
                  'application/json',
                )
              }
              onImportWorkspaceBackup={async (jsonText) => {
                const parsed = JSON.parse(jsonText) as WorkspaceState;
                setWorkspace(parsed);
                notify('Workspace backup restored successfully.');
              }}
              onResetWorkspace={async () => {
                await clearWorkspaceState();
                setWorkspace(createInitialWorkspaceState());
                setDemoLiveCache(null);
                notify('All local snapshots, notes, and logs cleared.');
              }}
            />
          )}
        </>
      )}

      {drawerAccount && (
        <AccountDrawer
          account={drawerAccount}
          onClose={() => setDrawerUsername(null)}
          onUpdateMetadata={updateMetadata}
          onQueueAccount={(u) => handleQueueUsernames([u])}
          onLiveProbeAccount={(u) => {
            const via = extStatus.authenticated ? 'extension' : 'companion';
            void handleRunFactCheck([u], via);
          }}
          canLiveVerify={canLiveVerify}
        />
      )}
    </div>
  );
}

export default App;
