import type { LiveGraphPayload, LiveProbeResult, SafetyConfig } from '../types';
import type {
  LiveVerifierTransport,
  TransportProgress,
  TransportSessionStatus,
  UnfollowExecutionResult,
} from './types';

const REQ_CHANNEL = 'IG_AUDITOR_EXT_REQ';
const RES_CHANNEL = 'IG_AUDITOR_EXT_RES';
const EVT_CHANNEL = 'IG_AUDITOR_EXT_EVT';

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ExtensionTransport implements LiveVerifierTransport {
  readonly id = 'extension' as const;
  readonly label = 'Browser Extension (MV3)';

  private pending = new Map<string, PendingCall>();
  private progressListener?: (progress: TransportProgress, latestProbe?: LiveProbeResult) => void;
  private listening = false;

  private ensureListener(): void {
    if (this.listening || typeof window === 'undefined') return;
    this.listening = true;
    window.addEventListener('message', (event) => {
      if (event.source !== window || !event.data || typeof event.data !== 'object') return;
      const msg = event.data as {
        channel?: string;
        requestId?: string;
        ok?: boolean;
        payload?: unknown;
        error?: string;
      };

      if (msg.channel === EVT_CHANNEL && this.progressListener && msg.payload) {
        const evt = msg.payload as { progress?: TransportProgress; latestProbe?: LiveProbeResult };
        if (evt.progress) {
          this.progressListener(evt.progress, evt.latestProbe);
        }
        return;
      }

      if (msg.channel === RES_CHANNEL && msg.requestId) {
        const call = this.pending.get(msg.requestId);
        if (!call) return;
        clearTimeout(call.timer);
        this.pending.delete(msg.requestId);
        if (msg.ok) {
          call.resolve(msg.payload);
        } else {
          call.reject(new Error(msg.error || 'Extension call failed'));
        }
      }
    });
  }

  private callExtension<T>(action: string, payload?: unknown, timeoutMs = 12_000): Promise<T> {
    this.ensureListener();
    const requestId = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('Browser extension did not respond. Load extension/ in Chrome/Edge first.'));
      }, timeoutMs);

      this.pending.set(requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      window.postMessage(
        {
          channel: REQ_CHANNEL,
          requestId,
          action,
          payload,
        },
        window.location.origin,
      );
    });
  }

  async ping(): Promise<TransportSessionStatus> {
    try {
      const res = await this.callExtension<TransportSessionStatus>('PING', undefined, 2500);
      return { ...res, connected: true, transportName: this.label };
    } catch (err) {
      return {
        connected: false,
        authenticated: false,
        transportName: this.label,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async syncLiveGraph(
    onProgress?: (progress: TransportProgress) => void,
    options?: { delayMs?: number; maxPages?: number },
  ): Promise<LiveGraphPayload> {
    this.progressListener = (progress) => onProgress?.(progress);
    try {
      return await this.callExtension<LiveGraphPayload>('SYNC_GRAPH', options, 15 * 60 * 1000);
    } finally {
      this.progressListener = undefined;
    }
  }

  async factCheckAccounts(
    targets: Array<{ username: string; userId?: string }>,
    onProgress?: (progress: TransportProgress, latestProbe?: LiveProbeResult) => void,
    options?: { delayMs?: number; useDomFallback?: boolean },
  ): Promise<LiveProbeResult[]> {
    this.progressListener = onProgress;
    try {
      return await this.callExtension<LiveProbeResult[]>(
        'FACT_CHECK_ACCOUNTS',
        { targets, ...options },
        15 * 60 * 1000,
      );
    } finally {
      this.progressListener = undefined;
    }
  }

  async unfollowAccount(
    target: { username: string; userId?: string },
    safetyConfig: SafetyConfig,
  ): Promise<UnfollowExecutionResult> {
    return this.callExtension<UnfollowExecutionResult>(
      'UNFOLLOW_ACCOUNT',
      {
        target,
        verifyBeforeUnfollow: safetyConfig.verifyBeforeUnfollow,
        useDomFallback: safetyConfig.useDomFallback,
      },
      60_000,
    );
  }

  async abort(): Promise<void> {
    await this.callExtension('ABORT_JOB', undefined, 3000).catch(() => undefined);
  }
}
