import { buildProfileUrl, normalizeUsername } from '../parsers/normalize';
import type { AccountEntry, LiveGraphPayload, LiveProbeResult } from '../types';

export function buildDevToolsSyncSnippet(options: {
  mode: 'full_graph' | 'targeted_probe';
  targetUsernames?: string[];
  delayMs?: number;
}): string {
  const delayMs = Math.max(800, options.delayMs ?? 1200);

  if (options.mode === 'targeted_probe') {
    const list = (options.targetUsernames ?? []).slice(0, 100);
    return `// IG Relationship Auditor — Targeted Live Fact-Check Snippet (Zero-Install)
// 1. Open https://www.instagram.com (logged in) -> Open DevTools Console (F12)
// 2. Paste & press Enter. Wait until "[IG Auditor] Done!" appears, then copy the JSON output.
(async () => {
  const targets = ${JSON.stringify(list)};
  const delayMs = ${delayMs};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || "";
  const headers = { "x-ig-app-id": "936619743392459", "x-csrftoken": csrf, "x-requested-with": "XMLHttpRequest" };
  const probes = [];
  console.log("[IG Auditor] Verifying", targets.length, "accounts...");

  for (let i = 0; i < targets.length; i++) {
    const username = targets[i];
    try {
      const r = await fetch("https://www.instagram.com/api/v1/users/web_profile_info/?username=" + encodeURIComponent(username), { credentials: "include", headers });
      if (r.status === 429) { console.warn("[IG Auditor] Rate limited at", username, "- stopping safely."); break; }
      if (r.status === 404) {
        probes.push({ username, normalizedUsername: username, accountExists: false, youFollow: false, followsYou: false, checkedAt: Date.now(), method: "devtools" });
      } else {
        const j = await r.json();
        const u = j?.data?.user;
        if (!u) {
          probes.push({ username, normalizedUsername: username, accountExists: false, checkedAt: Date.now(), method: "devtools" });
        } else {
          probes.push({
            username,
            normalizedUsername: (u.username || username).toLowerCase(),
            resolvedUsername: (u.username || username).toLowerCase(),
            userId: String(u.id),
            fullName: u.full_name || "",
            isPrivate: Boolean(u.is_private),
            isVerified: Boolean(u.is_verified),
            followerCount: u.edge_followed_by?.count,
            followingCount: u.edge_follow?.count,
            accountExists: true,
            youFollow: Boolean(u.followed_by_viewer),
            followsYou: Boolean(u.follows_viewer),
            checkedAt: Date.now(),
            method: "devtools"
          });
        }
      }
    } catch (err) {
      probes.push({ username, normalizedUsername: username, accountExists: true, checkedAt: Date.now(), method: "devtools", error: String(err) });
    }
    console.log(\`[IG Auditor] \${i + 1}/\${targets.length}: @\${username}\`);
    await sleep(delayMs + Math.random() * 600);
  }
  const output = JSON.stringify({ kind: "ig_auditor_probes", capturedAt: Date.now(), probes }, null, 2);
  if (typeof copy === "function") { copy(output); console.log("[IG Auditor] Done! Copied JSON to clipboard. Paste it into the Fact-Check tab."); }
  else { console.log("[IG Auditor] Done! Copy the JSON below:\\n", output); }
})();`;
  }

  return `// IG Relationship Auditor — Full Live Followers/Following Sync Snippet (Zero-Install)
// 1. Open https://www.instagram.com (logged in) -> Open DevTools Console (F12)
// 2. Paste & press Enter. It reads your active session politely with delays and copies JSON.
(async () => {
  const delayMs = ${delayMs};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || "";
  const userId = (document.cookie.match(/ds_user_id=([^;]+)/) || [])[1];
  if (!userId) { console.error("[IG Auditor] Not logged in (ds_user_id cookie missing)."); return; }
  const headers = { "x-ig-app-id": "936619743392459", "x-csrftoken": csrf, "x-requested-with": "XMLHttpRequest" };

  async function fetchList(kind) {
    const items = [];
    let maxId = "";
    let complete = true;
    for (let page = 0; page < 150; page++) {
      const qs = new URLSearchParams({ count: "50", ...(maxId ? { max_id: maxId } : {}) });
      const res = await fetch(\`https://www.instagram.com/api/v1/friendships/\${userId}/\${kind}/?\${qs}\`, { credentials: "include", headers });
      if (res.status === 429) { console.warn("[IG Auditor] Rate limited during", kind, "- stopping safely."); complete = false; break; }
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) { console.warn("[IG Auditor] Unexpected non-JSON response during", kind); complete = false; break; }
      const data = await res.json();
      for (const u of (data.users || [])) {
        items.push({ username: u.username, displayName: u.full_name || "", userId: String(u.pk || u.id || "") });
      }
      console.log(\`[IG Auditor] \${kind}: \${items.length} loaded...\`);
      if (!data.next_max_id) break;
      maxId = data.next_max_id;
      await sleep(delayMs + Math.random() * 700);
    }
    return { items, complete };
  }

  const followersRes = await fetchList("followers");
  const followingRes = await fetchList("following");
  const payload = {
    kind: "ig_auditor_live_graph",
    source: "devtools",
    ownerUserId: userId,
    capturedAt: Date.now(),
    followers: followersRes.items,
    following: followingRes.items,
    completeFollowers: followersRes.complete,
    completeFollowing: followingRes.complete
  };
  const json = JSON.stringify(payload, null, 2);
  if (typeof copy === "function") { copy(json); console.log("[IG Auditor] Done! Copied live graph JSON to clipboard. Paste into the Fact-Check tab."); }
  else { console.log("[IG Auditor] Done! Copy the JSON below:\\n", json); }
})();`;
}

export function parseDevToolsImport(rawText: string):
  | { type: 'live_graph'; payload: LiveGraphPayload }
  | { type: 'probes'; probes: LiveProbeResult[] } {
  const parsed = JSON.parse(rawText) as Record<string, unknown>;

  if (parsed.kind === 'ig_auditor_probes' || Array.isArray(parsed.probes)) {
    const rawProbes = Array.isArray(parsed.probes) ? parsed.probes : [];
    const probes: LiveProbeResult[] = [];
    for (const p of rawProbes) {
      if (!p || typeof p !== 'object') continue;
      const obj = p as Record<string, unknown>;
      const username = normalizeUsername(String(obj.username ?? ''));
      if (!username) continue;
      probes.push({
        username,
        normalizedUsername: normalizeUsername(String(obj.normalizedUsername ?? username)) ?? username,
        resolvedUsername: obj.resolvedUsername
          ? normalizeUsername(String(obj.resolvedUsername)) ?? undefined
          : undefined,
        userId: obj.userId ? String(obj.userId) : undefined,
        fullName: typeof obj.fullName === 'string' ? obj.fullName : undefined,
        isPrivate: typeof obj.isPrivate === 'boolean' ? obj.isPrivate : undefined,
        isVerified: typeof obj.isVerified === 'boolean' ? obj.isVerified : undefined,
        followerCount: typeof obj.followerCount === 'number' ? obj.followerCount : undefined,
        followingCount: typeof obj.followingCount === 'number' ? obj.followingCount : undefined,
        accountExists: obj.accountExists !== false,
        youFollow: typeof obj.youFollow === 'boolean' ? obj.youFollow : undefined,
        followsYou: typeof obj.followsYou === 'boolean' ? obj.followsYou : undefined,
        checkedAt: typeof obj.checkedAt === 'number' ? obj.checkedAt : Date.now(),
        method: 'devtools',
        error: typeof obj.error === 'string' ? obj.error : undefined,
      });
    }
    return { type: 'probes', probes };
  }

  const normalizeList = (arr: unknown): AccountEntry[] => {
    if (!Array.isArray(arr)) return [];
    const out: AccountEntry[] = [];
    for (const item of arr) {
      if (typeof item === 'string') {
        const u = normalizeUsername(item);
        if (u) out.push({ username: u, profileUrl: buildProfileUrl(u) });
      } else if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const u = normalizeUsername(String(obj.username ?? ''));
        if (!u) continue;
        out.push({
          username: u,
          displayName: typeof obj.displayName === 'string' ? obj.displayName : undefined,
          userId: obj.userId ? String(obj.userId) : undefined,
          profileUrl: buildProfileUrl(u),
        });
      }
    }
    return out;
  };

  if (Array.isArray(parsed.followers) || Array.isArray(parsed.following)) {
    return {
      type: 'live_graph',
      payload: {
        source: 'devtools',
        ownerUsername:
          typeof parsed.ownerUsername === 'string'
            ? normalizeUsername(parsed.ownerUsername) ?? undefined
            : undefined,
        ownerUserId: typeof parsed.ownerUserId === 'string' ? parsed.ownerUserId : undefined,
        capturedAt: typeof parsed.capturedAt === 'number' ? parsed.capturedAt : Date.now(),
        followers: normalizeList(parsed.followers),
        following: normalizeList(parsed.following),
        completeFollowers: parsed.completeFollowers !== false,
        completeFollowing: parsed.completeFollowing !== false,
      },
    };
  }

  throw new Error(
    'Unrecognized DevTools JSON format. Expected ig_auditor_live_graph or ig_auditor_probes JSON.',
  );
}
