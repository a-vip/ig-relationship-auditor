import type { LiveGraphPayload, LiveProbeResult, SafetyConfig } from '../types';

export interface TransportSessionStatus {
  connected: boolean;
  authenticated: boolean;
  ownerUsername?: string;
  ownerUserId?: string;
  transportName: string;
  version?: string;
  error?: string;
}

export interface TransportProgress {
  phase: 'init' | 'followers' | 'following' | 'probing' | 'unfollowing' | 'done' | 'paused' | 'aborted';
  message: string;
  current: number;
  total?: number;
}

export interface UnfollowExecutionResult {
  ok: boolean;
  username: string;
  verifiedFollowing?: boolean;
  methodUsed: 'extension_api' | 'extension_dom' | 'companion_api' | 'companion_dom';
  rateLimited?: boolean;
  error?: string;
}

export interface LiveVerifierTransport {
  readonly id: 'extension' | 'companion';
  readonly label: string;
  ping(): Promise<TransportSessionStatus>;
  syncLiveGraph(
    onProgress?: (progress: TransportProgress) => void,
    options?: { delayMs?: number; maxPages?: number },
  ): Promise<LiveGraphPayload>;
  factCheckAccounts(
    targets: Array<{ username: string; userId?: string }>,
    onProgress?: (progress: TransportProgress, latestProbe?: LiveProbeResult) => void,
    options?: { delayMs?: number; useDomFallback?: boolean },
  ): Promise<LiveProbeResult[]>;
  unfollowAccount(
    target: { username: string; userId?: string },
    safetyConfig: SafetyConfig,
  ): Promise<UnfollowExecutionResult>;
  abort(): Promise<void>;
}
