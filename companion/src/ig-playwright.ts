import os from 'node:os';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { normalizeHandle, type LiveProbeResult } from './protocol.js';

const IG_APP_ID = '936619743392459';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function defaultProfileDir(): string {
  return path.join(os.homedir(), '.ig-relationship-auditor', 'playwright-profile');
}

export class InstagramPlaywrightClient {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private aborted = false;

  constructor(
    private readonly profileDir: string = defaultProfileDir(),
    private readonly headless: boolean = true,
  ) {}

  requestAbort(): void {
    this.aborted = true;
  }

  private async ensurePage(forceHeaded = false): Promise<Page> {
    if (this.context && forceHeaded && this.headless) {
      await this.close();
    }

    if (!this.context) {
      this.context = await chromium.launchPersistentContext(this.profileDir, {
        headless: forceHeaded ? false : this.headless,
        viewport: { width: 1280, height: 840 },
        args: ['--disable-blink-features=AutomationControlled'],
      });
    }

    if (!this.page || this.page.isClosed()) {
      const existing = this.context.pages();
      this.page = existing[0] ?? (await this.context.newPage());
    }

    if (!this.page.url().startsWith('https://www.instagram.com')) {
      await this.page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
      await sleep(1200);
    }

    return this.page;
  }

  async openInteractiveLogin(): Promise<{ ok: boolean; ownerUsername?: string; message: string }> {
    const page = await this.ensurePage(true);
    await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded' });
    return {
      ok: true,
      message: 'Browser window opened. Complete login (including 2FA if prompted), then click Refresh Status in the dashboard.',
    };
  }

  async getSessionStatus(): Promise<{
    authenticated: boolean;
    ownerUsername?: string;
    ownerUserId?: string;
    error?: string;
  }> {
    try {
      const page = await this.ensurePage(false);
      const cookies = await this.context!.cookies('https://www.instagram.com');
      const dsUserId = cookies.find((c) => c.name === 'ds_user_id')?.value;
      const sessionId = cookies.find((c) => c.name === 'sessionid')?.value;
      const csrfToken = cookies.find((c) => c.name === 'csrftoken')?.value || '';

      if (!dsUserId || !sessionId) {
        return { authenticated: false, error: 'Not signed into Instagram in Playwright profile.' };
      }

      const info = await page.evaluate(
        async ({ userId, csrf, appId }) => {
          const res = await fetch(`https://www.instagram.com/api/v1/users/${userId}/info/`, {
            credentials: 'include',
            headers: {
              'x-ig-app-id': appId,
              'x-csrftoken': csrf,
              'x-requested-with': 'XMLHttpRequest',
            },
          });
          if (!res.ok) return null;
          return res.json();
        },
        { userId: dsUserId, csrf: csrfToken, appId: IG_APP_ID },
      );

      return {
        authenticated: true,
        ownerUserId: dsUserId,
        ownerUsername: info?.user?.username,
      };
    } catch (err) {
      return {
        authenticated: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async syncLiveGraph(options: { delayMs?: number; maxPages?: number } = {}) {
    this.aborted = false;
    const delayMs = Math.max(900, options.delayMs ?? 1300);
    const maxPages = Math.min(250, options.maxPages ?? 150);
    const status = await this.getSessionStatus();
    if (!status.authenticated || !status.ownerUserId) {
      throw new Error(status.error || 'Playwright profile is not logged into Instagram.');
    }

    const page = await this.ensurePage(false);
    const cookies = await this.context!.cookies('https://www.instagram.com');
    const csrfToken = cookies.find((c) => c.name === 'csrftoken')?.value || '';

    const fetchList = async (kind: 'followers' | 'following') => {
      const items: Array<{ username: string; displayName?: string; profileUrl: string; userId?: string }> = [];
      let maxId = '';
      let complete = true;

      for (let i = 0; i < maxPages; i += 1) {
        if (this.aborted) {
          complete = false;
          break;
        }
        const chunk = await page.evaluate(
          async ({ userId, listKind, cursor, csrf, appId }) => {
            const qs = new URLSearchParams({ count: '50', ...(cursor ? { max_id: cursor } : {}) });
            const res = await fetch(
              `https://www.instagram.com/api/v1/friendships/${userId}/${listKind}/?${qs}`,
              {
                credentials: 'include',
                headers: {
                  'x-ig-app-id': appId,
                  'x-csrftoken': csrf,
                  'x-requested-with': 'XMLHttpRequest',
                },
              },
            );
            const ct = res.headers.get('content-type') || '';
            if (res.status === 429) return { rateLimited: true };
            if (!ct.includes('application/json')) return { nonJson: true, status: res.status };
            const data = await res.json();
            return { users: data.users || [], nextMaxId: data.next_max_id || '' };
          },
          { userId: status.ownerUserId!, listKind: kind, cursor: maxId, csrf: csrfToken, appId: IG_APP_ID },
        );

        if ('rateLimited' in chunk || 'nonJson' in chunk) {
          complete = false;
          break;
        }

        for (const u of chunk.users) {
          if (!u?.username) continue;
          const handle = normalizeHandle(String(u.username));
          items.push({
            username: handle,
            displayName: u.full_name || '',
            profileUrl: `https://www.instagram.com/${encodeURIComponent(handle)}/`,
            userId: String(u.pk || u.id || ''),
          });
        }

        if (!chunk.nextMaxId) break;
        maxId = chunk.nextMaxId;
        await sleep(delayMs + Math.round(Math.random() * 650));
      }

      return { items, complete };
    };

    const followersRes = await fetchList('followers');
    const followingRes = this.aborted ? { items: [], complete: false } : await fetchList('following');

    return {
      source: 'companion' as const,
      ownerUsername: status.ownerUsername,
      ownerUserId: status.ownerUserId,
      capturedAt: Date.now(),
      followers: followersRes.items,
      following: followingRes.items,
      completeFollowers: followersRes.complete,
      completeFollowing: followingRes.complete,
    };
  }

  async factCheckAccounts(
    targets: Array<{ username: string; userId?: string }>,
    options: { delayMs?: number; useDomFallback?: boolean } = {},
  ): Promise<LiveProbeResult[]> {
    this.aborted = false;
    const delayMs = Math.max(850, options.delayMs ?? 1200);
    const page = await this.ensurePage(false);
    const cookies = await this.context!.cookies('https://www.instagram.com');
    const csrfToken = cookies.find((c) => c.name === 'csrftoken')?.value || '';
    const results: LiveProbeResult[] = [];

    for (let i = 0; i < targets.length; i += 1) {
      if (this.aborted) break;
      const username = normalizeHandle(targets[i].username);
      const apiProbe = await page.evaluate(
        async ({ handle, csrf, appId }) => {
          const res = await fetch(
            `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`,
            {
              credentials: 'include',
              headers: {
                'x-ig-app-id': appId,
                'x-csrftoken': csrf,
                'x-requested-with': 'XMLHttpRequest',
              },
            },
          );
          if (res.status === 429) return { status: 429 };
          if (res.status === 404) return { status: 404 };
          const ct = res.headers.get('content-type') || '';
          if (!ct.includes('application/json')) return { status: res.status, nonJson: true };
          return { status: res.status, data: await res.json() };
        },
        { handle: username, csrf: csrfToken, appId: IG_APP_ID },
      );

      if (apiProbe.status === 429) {
        results.push({
          username,
          normalizedUsername: username,
          accountExists: true,
          checkedAt: Date.now(),
          method: 'companion',
          error: 'rate_limited',
        });
        break;
      }

      if (apiProbe.status === 404) {
        results.push({
          username,
          normalizedUsername: username,
          accountExists: false,
          youFollow: false,
          followsYou: false,
          checkedAt: Date.now(),
          method: 'companion',
        });
      } else if (apiProbe.data?.data?.user) {
        const u = apiProbe.data.data.user;
        const resolved = normalizeHandle(String(u.username || username));
        results.push({
          username,
          normalizedUsername: resolved,
          resolvedUsername: resolved,
          userId: String(u.id),
          fullName: u.full_name || '',
          isPrivate: Boolean(u.is_private),
          isVerified: Boolean(u.is_verified),
          followerCount: u.edge_followed_by?.count,
          followingCount: u.edge_follow?.count,
          accountExists: true,
          youFollow: Boolean(u.followed_by_viewer),
          followsYou: Boolean(u.follows_viewer),
          checkedAt: Date.now(),
          method: 'companion',
        });
      } else if (options.useDomFallback !== false) {
        // Real Playwright DOM fallback check
        await page.goto(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
          waitUntil: 'domcontentloaded',
        });
        await sleep(1400);
        const bodyText = (await page.locator('body').innerText()).toLowerCase();
        const missing =
          bodyText.includes("sorry, this page isn't available") ||
          bodyText.includes('the link you followed may be broken');
        if (missing) {
          results.push({
            username,
            normalizedUsername: username,
            accountExists: false,
            youFollow: false,
            followsYou: false,
            checkedAt: Date.now(),
            method: 'companion',
          });
        } else {
          const btnTexts = await page
            .locator('header button')
            .allInnerTexts()
            .then((arr) => arr.map((s) => s.trim().toLowerCase()));
          const youFollow = btnTexts.includes('following') || btnTexts.includes('requested');
          const followsYou = btnTexts.includes('follow back') ? true : undefined;
          results.push({
            username,
            normalizedUsername: username,
            accountExists: true,
            youFollow,
            followsYou,
            checkedAt: Date.now(),
            method: 'companion',
          });
        }
      } else {
        results.push({
          username,
          normalizedUsername: username,
          accountExists: true,
          checkedAt: Date.now(),
          method: 'companion',
          error: 'Could not resolve profile via API',
        });
      }

      if (i < targets.length - 1) {
        await sleep(delayMs + Math.round(Math.random() * 600));
      }
    }

    return results;
  }

  async unfollowAccount(
    target: { username: string; userId?: string },
    options: { verifyBeforeUnfollow?: boolean; useDomFallback?: boolean } = {},
  ) {
    const username = normalizeHandle(target.username);
    let userId = target.userId;

    if (options.verifyBeforeUnfollow || !userId) {
      const [probe] = await this.factCheckAccounts([{ username, userId }], {
        useDomFallback: options.useDomFallback,
      });
      if (probe?.error === 'rate_limited') {
        return {
          ok: false,
          username,
          methodUsed: 'companion_api' as const,
          rateLimited: true,
          error: 'Rate limited during pre-flight verification',
        };
      }
      if (probe && !probe.accountExists) {
        return {
          ok: true,
          username,
          verifiedFollowing: false,
          methodUsed: 'companion_api' as const,
        };
      }
      if (options.verifyBeforeUnfollow && probe?.followsYou === true) {
        return {
          ok: false,
          username,
          verifiedFollowing: probe.youFollow,
          methodUsed: 'companion_api' as const,
          error: 'Pre-flight check detected they follow you back — unfollow skipped.',
        };
      }
      if (probe?.youFollow === false) {
        return {
          ok: true,
          username,
          verifiedFollowing: false,
          methodUsed: 'companion_api' as const,
        };
      }
      userId = probe?.userId || userId;
    }

    const page = await this.ensurePage(false);
    const cookies = await this.context!.cookies('https://www.instagram.com');
    const csrfToken = cookies.find((c) => c.name === 'csrftoken')?.value || '';

    if (userId) {
      const destroyRes = await page.evaluate(
        async ({ id, csrf, appId }) => {
          const res = await fetch(`https://www.instagram.com/api/v1/friendships/destroy/${id}/`, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'x-ig-app-id': appId,
              'x-csrftoken': csrf,
              'x-requested-with': 'XMLHttpRequest',
              'content-type': 'application/x-www-form-urlencoded',
            },
            body: `user_id=${encodeURIComponent(id)}`,
          });
          if (res.status === 429) return { rateLimited: true };
          const ct = res.headers.get('content-type') || '';
          if (!ct.includes('application/json')) return { ok: false };
          const data = await res.json();
          return {
            ok: res.ok && data?.status === 'ok' && data?.friendship_status?.following === false,
          };
        },
        { id: userId, csrf: csrfToken, appId: IG_APP_ID },
      );

      if ('rateLimited' in destroyRes) {
        return {
          ok: false,
          username,
          methodUsed: 'companion_api' as const,
          rateLimited: true,
          error: 'HTTP 429 Rate limited by Instagram',
        };
      }
      if (destroyRes.ok) {
        return {
          ok: true,
          username,
          verifiedFollowing: false,
          methodUsed: 'companion_api' as const,
        };
      }
    }

    if (options.useDomFallback !== false) {
      await page.goto(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
        waitUntil: 'domcontentloaded',
      });
      await sleep(1500);
      const followingBtn = page.locator('header button:has-text("Following")').first();
      if (await followingBtn.count()) {
        await followingBtn.click();
        await sleep(800);
        const confirmBtn = page.locator('div[role="dialog"] button:has-text("Unfollow")').first();
        if (await confirmBtn.count()) {
          await confirmBtn.click();
          await sleep(1300);
          const stillFollowing = (await page.locator('header button:has-text("Following")').count()) > 0;
          return {
            ok: !stillFollowing,
            username,
            verifiedFollowing: stillFollowing,
            methodUsed: 'companion_dom' as const,
            error: stillFollowing ? 'Button remained Following after DOM click' : undefined,
          };
        }
      }
    }

    return {
      ok: false,
      username,
      methodUsed: 'companion_api' as const,
      error: 'Could not complete unfollow via API or DOM',
    };
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close().catch(() => undefined);
      this.context = null;
      this.page = null;
    }
  }
}
