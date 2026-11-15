import type {
  AccountMetadata,
  EnrichedAccount,
  ExportSnapshot,
  LiveGraphPayload,
  LiveProbeResult,
  SafetyConfig,
  SmartProtectionConfig,
  UnfollowAuditEntry,
} from '../types';
import { DEFAULT_PROTECTION_CONFIG, DEFAULT_SAFETY_CONFIG } from '../reconciliation/safetyRules';

export interface WorkspaceState {
  snapshots: ExportSnapshot[];
  activeSnapshotId: string | null;
  liveGraph: LiveGraphPayload | null;
  liveProbes: Record<string, LiveProbeResult>;
  metadataMap: Record<string, AccountMetadata>;
  auditLog: UnfollowAuditEntry[];
  unfollowQueue: string[];
  protectionConfig: SmartProtectionConfig;
  safetyConfig: SafetyConfig;
  disabledAnalyzers: string[];
  theme: 'dark' | 'light';
}

export function createInitialWorkspaceState(): WorkspaceState {
  return {
    snapshots: [],
    activeSnapshotId: null,
    liveGraph: null,
    liveProbes: {},
    metadataMap: {},
    auditLog: [],
    unfollowQueue: [],
    protectionConfig: { ...DEFAULT_PROTECTION_CONFIG },
    safetyConfig: { ...DEFAULT_SAFETY_CONFIG },
    disabledAnalyzers: [],
    theme: 'dark',
  };
}

const DB_NAME = 'ig-relationship-auditor-db';
const DB_VERSION = 1;
const STORE_NAME = 'workspace';
const STATE_KEY = 'state-v1';
const FALLBACK_LS_KEY = 'ig-relationship-auditor-state-v1';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadWorkspaceState(): Promise<WorkspaceState> {
  const fallback = createInitialWorkspaceState();
  try {
    if (typeof indexedDB !== 'undefined') {
      const db = await openDatabase();
      const data = await new Promise<Partial<WorkspaceState> | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(STATE_KEY);
        req.onsuccess = () => resolve(req.result as Partial<WorkspaceState> | undefined);
        req.onerror = () => reject(req.error);
      });
      db.close();
      if (data) {
        return mergeWithDefaults(fallback, data);
      }
    }
  } catch {
    // Fallback to localStorage below
  }

  try {
    const raw = localStorage.getItem(FALLBACK_LS_KEY);
    if (raw) {
      return mergeWithDefaults(fallback, JSON.parse(raw) as Partial<WorkspaceState>);
    }
  } catch {
    // Ignore storage read failures
  }

  return fallback;
}

export async function saveWorkspaceState(state: WorkspaceState): Promise<void> {
  try {
    if (typeof indexedDB !== 'undefined') {
      const db = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(state, STATE_KEY);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      db.close();
      return;
    }
  } catch {
    // Fallback to localStorage
  }

  try {
    localStorage.setItem(FALLBACK_LS_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors cleanly
  }
}

export async function clearWorkspaceState(): Promise<void> {
  try {
    if (typeof indexedDB !== 'undefined') {
      const db = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const req = tx.objectStore(STORE_NAME).delete(STATE_KEY);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      db.close();
    }
  } catch {
    // ignore
  }
  try {
    localStorage.removeItem(FALLBACK_LS_KEY);
  } catch {
    // ignore
  }
}

function mergeWithDefaults(
  defaults: WorkspaceState,
  partial: Partial<WorkspaceState>,
): WorkspaceState {
  return {
    ...defaults,
    ...partial,
    snapshots: Array.isArray(partial.snapshots) ? partial.snapshots : defaults.snapshots,
    liveProbes: partial.liveProbes ?? defaults.liveProbes,
    metadataMap: partial.metadataMap ?? defaults.metadataMap,
    auditLog: Array.isArray(partial.auditLog) ? partial.auditLog : defaults.auditLog,
    unfollowQueue: Array.isArray(partial.unfollowQueue) ? partial.unfollowQueue : defaults.unfollowQueue,
    protectionConfig: { ...defaults.protectionConfig, ...(partial.protectionConfig ?? {}) },
    safetyConfig: { ...defaults.safetyConfig, ...(partial.safetyConfig ?? {}) },
    disabledAnalyzers: Array.isArray(partial.disabledAnalyzers)
      ? partial.disabledAnalyzers
      : defaults.disabledAnalyzers,
  };
}

export function exportAccountsToCsv(accounts: EnrichedAccount[]): string {
  const headers = [
    'username',
    'display_name',
    'profile_url',
    'is_following',
    'is_follower',
    'is_not_following_back',
    'verification_status',
    'whitelisted',
    'protected_by_rule',
    'unfollow_state',
    'followed_at',
    'tags',
    'note',
  ];

  const escapeCell = (val: unknown): string => {
    const str = String(val ?? '');
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = accounts.map((a) =>
    [
      a.username,
      a.displayName ?? '',
      a.profileUrl,
      a.isFollowing,
      a.isFollower,
      a.isNotFollowingBack,
      a.verificationStatus,
      a.whitelisted,
      a.protectedByRule ?? '',
      a.unfollowState,
      a.followedAt ? new Date(a.followedAt).toISOString() : '',
      a.tags.join('; '),
      a.note,
    ]
      .map(escapeCell)
      .join(','),
  );

  return [headers.join(','), ...rows].join('\n');
}
