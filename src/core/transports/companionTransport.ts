import type { LiveGraphPayload, LiveProbeResult, SafetyConfig } from '../types';
import type {
  LiveVerifierTransport,
  TransportProgress,
  TransportSessionStatus,
  UnfollowExecutionResult,
} from './types';

export class CompanionTransport implements LiveVerifierTransport {
  readonly id = 'companion' as const;
  readonly label = 'Local Playwright Companion';

  private baseUrl: string;
  private token: string;
  private activeAbortController: AbortController | null = null;

  constructor(baseUrl = 'http://127.0.0.1:47831', token = '') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token.trim();
  }

  configure(baseUrl: string, token: string): void {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token.trim();
  }

  private headers(): HeadersInit {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      h['X-Auditor-Token'] = this.token;
    }
    return h;
  }

  async ping(): Promise<TransportSessionStatus> {
    try {
      const res = await fetch(`${this.baseUrl}/api/status`, {
        method: 'GET',
        headers: this.headers(),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        const text = await res.text();
        return {
          connected: res.status !== 0,
          authenticated: false,
          transportName: this.label,
          error: `Companion responded ${res.status}: ${text}`,
        };
      }
      const data = (await res.json()) as TransportSessionStatus;
      return { ...data, connected: true, transportName: this.label };
    } catch (err) {
      return {
        connected: false,
        authenticated: false,
        transportName: this.label,
        error:
          err instanceof Error
            ? `Cannot reach ${this.baseUrl} (${err.message})`
            : 'Cannot reach local companion',
      };
    }
  }

  async openLoginBrowser(): Promise<{ ok: boolean; ownerUsername?: string; message?: string }> {
    const res = await fetch(`${this.baseUrl}/api/login`, {
      method: 'POST',
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    return (await res.json()) as { ok: boolean; ownerUsername?: string; message?: string };
  }

  async syncLiveGraph(
    onProgress?: (progress: TransportProgress) => void,
    options?: { delayMs?: number; maxPages?: number },
  ): Promise<LiveGraphPayload> {
    this.activeAbortController = new AbortController();
    onProgress?.({ phase: 'init', message: 'Starting Playwright live sync...', current: 0 });

    const res = await fetch(`${this.baseUrl}/api/sync-graph`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(options ?? {}),
      signal: this.activeAbortController.signal,
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const payload = (await res.json()) as LiveGraphPayload;
    onProgress?.({
      phase: 'done',
      message: `Synced ${payload.followers.length} followers and ${payload.following.length} following.`,
      current: 100,
      total: 100,
    });
    return payload;
  }

  async factCheckAccounts(
    targets: Array<{ username: string; userId?: string }>,
    onProgress?: (progress: TransportProgress, latestProbe?: LiveProbeResult) => void,
    options?: { delayMs?: number; useDomFallback?: boolean },
  ): Promise<LiveProbeResult[]> {
    this.activeAbortController = new AbortController();
    const results: LiveProbeResult[] = [];

    for (let i = 0; i < targets.length; i += 1) {
      if (this.activeAbortController.signal.aborted) break;
      const target = targets[i];
      onProgress?.({
        phase: 'probing',
        message: `Fact-checking @${target.username} (${i + 1}/${targets.length})...`,
        current: i,
        total: targets.length,
      });

      const res = await fetch(`${this.baseUrl}/api/fact-check`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ targets: [target], ...options }),
        signal: this.activeAbortController.signal,
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const batch = (await res.json()) as LiveProbeResult[];
      for (const probe of batch) {
        results.push(probe);
        onProgress?.(
          {
            phase: 'probing',
            message: `Checked @${probe.username}`,
            current: i + 1,
            total: targets.length,
          },
          probe,
        );
      }
    }

    onProgress?.({
      phase: 'done',
      message: `Fact-checked ${results.length} accounts.`,
      current: results.length,
      total: targets.length,
    });

    return results;
  }

  async unfollowAccount(
    target: { username: string; userId?: string },
    safetyConfig: SafetyConfig,
  ): Promise<UnfollowExecutionResult> {
    const res = await fetch(`${this.baseUrl}/api/unfollow`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        target,
        verifyBeforeUnfollow: safetyConfig.verifyBeforeUnfollow,
        useDomFallback: safetyConfig.useDomFallback,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        username: target.username,
        methodUsed: 'companion_api',
        error: text,
      };
    }
    return (await res.json()) as UnfollowExecutionResult;
  }

  async abort(): Promise<void> {
    this.activeAbortController?.abort();
    await fetch(`${this.baseUrl}/api/abort`, {
      method: 'POST',
      headers: this.headers(),
    }).catch(() => undefined);
  }
}
