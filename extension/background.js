const IG_APP_ID = '936619743392459';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let abortRequested = false;
let activeJobState = {
  running: false,
  phase: 'idle',
  message: 'Idle',
  updatedAt: Date.now(),
};

async function updateJobState(partial) {
  activeJobState = { ...activeJobState, ...partial, updatedAt: Date.now() };
  await chrome.storage.local.set({ activeJobState }).catch(() => undefined);
}

function broadcastProgress(tabId, progress, latestProbe) {
  if (!tabId) return;
  chrome.tabs
    .sendMessage(tabId, {
      type: 'AUDITOR_PROGRESS',
      payload: { progress, latestProbe },
    })
    .catch(() => undefined);
}

async function getIgSessionCookies() {
  const cookies = await chrome.cookies.getAll({ url: 'https://www.instagram.com' });
  const map = new Map(cookies.map((c) => [c.name, c.value]));
  const dsUserId = map.get('ds_user_id') || '';
  const csrfToken = map.get('csrftoken') || '';
  const hasSession = Boolean(map.get('sessionid') && dsUserId);
  return { dsUserId, csrfToken, hasSession };
}

async function igFetchJson(url, options = {}) {
  const { csrfToken } = await getIgSessionCookies();
  const headers = {
    'x-ig-app-id': IG_APP_ID,
    'x-csrftoken': csrfToken,
    'x-requested-with': 'XMLHttpRequest',
    ...(options.headers || {}),
  };

  const res = await fetch(url, {
    method: options.method || 'GET',
    credentials: 'include',
    headers,
    body: options.body,
  });

  if (res.status === 429) {
    return { ok: false, status: 429, rateLimited: true, error: 'HTTP 429 Rate Limited by Instagram' };
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return {
      ok: false,
      status: res.status,
      nonJson: true,
      error: `Instagram returned non-JSON (${res.status}). Session may require login or challenge.`,
    };
  }

  const data = await res.json();
  if (data?.message === 'challenge_required' || data?.challenge) {
    return {
      ok: false,
      status: res.status,
      rateLimited: true,
      error: 'Instagram security challenge required. Open instagram.com to verify.',
    };
  }

  return { ok: res.ok, status: res.status, data };
}

async function pingSession() {
  const { dsUserId, hasSession } = await getIgSessionCookies();
  if (!hasSession) {
    return {
      connected: true,
      authenticated: false,
      version: '1.0.0',
      error: 'Not logged into instagram.com in this browser profile.',
    };
  }

  let ownerUsername;
  try {
    const info = await igFetchJson(
      `https://www.instagram.com/api/v1/users/${encodeURIComponent(dsUserId)}/info/`,
    );
    ownerUsername = info.data?.user?.username;
  } catch {
    // Fallback check using current_user endpoint
    try {
      const curr = await igFetchJson('https://www.instagram.com/api/v1/accounts/current_user/?edit=true');
      ownerUsername = curr.data?.user?.username;
    } catch {
      ownerUsername = undefined;
    }
  }

  return {
    connected: true,
    authenticated: true,
    ownerUserId: dsUserId,
    ownerUsername,
    version: '1.0.0',
  };
}

async function syncRelationshipList(userId, kind, tabId, delayMs, maxPages) {
  const items = [];
  let maxId = '';
  let complete = true;

  for (let page = 0; page < maxPages; page += 1) {
    if (abortRequested) {
      complete = false;
      break;
    }

    const qs = new URLSearchParams({ count: '50', ...(maxId ? { max_id: maxId } : {}) });
    const res = await igFetchJson(
      `https://www.instagram.com/api/v1/friendships/${encodeURIComponent(userId)}/${kind}/?${qs}`,
    );

    if (!res.ok) {
      complete = false;
      broadcastProgress(tabId, {
        phase: res.rateLimited ? 'paused' : 'aborted',
        message: res.error || `Stopped ${kind} sync`,
        current: items.length,
      });
      break;
    }

    const users = res.data?.users || [];
    for (const u of users) {
      if (!u?.username) continue;
      items.push({
        username: String(u.username).toLowerCase(),
        displayName: u.full_name || '',
        profileUrl: `https://www.instagram.com/${encodeURIComponent(String(u.username).toLowerCase())}/`,
        userId: String(u.pk || u.id || ''),
      });
    }

    const msg = `Synced ${items.length} ${kind}...`;
    await updateJobState({ running: true, phase: kind, message: msg });
    broadcastProgress(tabId, { phase: kind, message: msg, current: items.length });

    if (!res.data?.next_max_id) break;
    maxId = res.data.next_max_id;
    await sleep(delayMs + Math.round(Math.random() * 650));
  }

  return { items, complete };
}

async function handleSyncGraph(payload, tabId) {
  abortRequested = false;
  const delayMs = Math.max(900, payload?.delayMs ?? 1300);
  const maxPages = Math.min(250, payload?.maxPages ?? 150);

  const session = await pingSession();
  if (!session.authenticated || !session.ownerUserId) {
    throw new Error(session.error || 'Instagram session not authenticated');
  }

  await updateJobState({ running: true, phase: 'followers', message: 'Starting live graph sync...' });
  const followersRes = await syncRelationshipList(
    session.ownerUserId,
    'followers',
    tabId,
    delayMs,
    maxPages,
  );

  let followingRes = { items: [], complete: false };
  if (!abortRequested) {
    followingRes = await syncRelationshipList(
      session.ownerUserId,
      'following',
      tabId,
      delayMs,
      maxPages,
    );
  }

  await updateJobState({ running: false, phase: 'idle', message: 'Sync finished' });
  broadcastProgress(tabId, {
    phase: abortRequested ? 'aborted' : 'done',
    message: abortRequested
      ? 'Live sync aborted by user'
      : `Synced ${followersRes.items.length} followers & ${followingRes.items.length} following.`,
    current: followersRes.items.length + followingRes.items.length,
  });

  return {
    source: 'extension',
    ownerUsername: session.ownerUsername,
    ownerUserId: session.ownerUserId,
    capturedAt: Date.now(),
    followers: followersRes.items,
    following: followingRes.items,
    completeFollowers: followersRes.complete,
    completeFollowing: followingRes.complete,
  };
}

async function probeSingleAccount(target) {
  const username = String(target.username || '').toLowerCase();
  const profileRes = await igFetchJson(
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
  );

  if (profileRes.rateLimited) {
    return {
      username,
      normalizedUsername: username,
      accountExists: true,
      checkedAt: Date.now(),
      method: 'extension',
      error: 'rate_limited',
    };
  }

  if (profileRes.status === 404) {
    return {
      username,
      normalizedUsername: username,
      accountExists: false,
      youFollow: false,
      followsYou: false,
      checkedAt: Date.now(),
      method: 'extension',
    };
  }

  if (profileRes.ok && profileRes.data?.data?.user) {
    const u = profileRes.data.data.user;
    const resolvedUsername = String(u.username || username).toLowerCase();
    return {
      username,
      normalizedUsername: resolvedUsername,
      resolvedUsername,
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
      method: 'extension',
    };
  }

  // Fallback to friendships/show when userId is known
  if (target.userId) {
    const relRes = await igFetchJson(
      `https://www.instagram.com/api/v1/friendships/show/${encodeURIComponent(target.userId)}/`,
    );
    if (relRes.ok && relRes.data) {
      return {
        username,
        normalizedUsername: username,
        userId: String(target.userId),
        accountExists: true,
        youFollow: Boolean(relRes.data.following),
        followsYou: Boolean(relRes.data.followed_by),
        checkedAt: Date.now(),
        method: 'extension',
      };
    }
  }

  return {
    username,
    normalizedUsername: username,
    accountExists: true,
    checkedAt: Date.now(),
    method: 'extension',
    error: profileRes.error || 'Could not resolve profile details',
  };
}

async function handleFactCheckAccounts(payload, tabId) {
  abortRequested = false;
  const targets = Array.isArray(payload?.targets) ? payload.targets : [];
  const delayMs = Math.max(900, payload?.delayMs ?? 1200);
  const results = [];

  for (let i = 0; i < targets.length; i += 1) {
    if (abortRequested) break;
    const target = targets[i];
    await updateJobState({
      running: true,
      phase: 'probing',
      message: `Checking @${target.username} (${i + 1}/${targets.length})`,
    });

    const probe = await probeSingleAccount(target);
    results.push(probe);

    broadcastProgress(
      tabId,
      {
        phase: 'probing',
        message: `Fact-checked @${target.username} (${i + 1}/${targets.length})`,
        current: i + 1,
        total: targets.length,
      },
      probe,
    );

    if (probe.error === 'rate_limited') {
      break;
    }

    if (i < targets.length - 1) {
      await sleep(delayMs + Math.round(Math.random() * 650));
    }
  }

  await updateJobState({ running: false, phase: 'idle', message: 'Fact-check finished' });
  broadcastProgress(tabId, {
    phase: abortRequested ? 'aborted' : 'done',
    message: `Completed fact-check for ${results.length} accounts`,
    current: results.length,
    total: targets.length,
  });

  return results;
}

async function unfollowViaWorkerTabDom(username) {
  let tab;
  try {
    tab = await chrome.tabs.create({
      url: `https://www.instagram.com/${encodeURIComponent(username)}/`,
      active: false,
    });

    await new Promise((resolve) => {
      const listener = (updatedId, info) => {
        if (updatedId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 12_000);
    });

    await sleep(1600);
    const domRes = await chrome.tabs.sendMessage(tab.id, {
      type: 'IG_DOM_UNFOLLOW',
      username,
    });
    return {
      ok: Boolean(domRes?.ok),
      username,
      verifiedFollowing: domRes?.verifiedFollowing,
      methodUsed: 'extension_dom',
      error: domRes?.error,
    };
  } catch (err) {
    return {
      ok: false,
      username,
      methodUsed: 'extension_dom',
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (tab?.id) {
      await chrome.tabs.remove(tab.id).catch(() => undefined);
    }
  }
}

async function handleUnfollowAccount(payload) {
  const target = payload?.target || {};
  const username = String(target.username || '').toLowerCase();
  let userId = target.userId;

  if (!username) {
    return { ok: false, username: '', methodUsed: 'extension_api', error: 'Missing username' };
  }

  if (payload?.verifyBeforeUnfollow || !userId) {
    const probe = await probeSingleAccount({ username, userId });
    if (probe.error === 'rate_limited') {
      return {
        ok: false,
        username,
        methodUsed: 'extension_api',
        rateLimited: true,
        error: 'Rate limited during pre-flight verification',
      };
    }
    if (!probe.accountExists) {
      return {
        ok: true,
        username,
        verifiedFollowing: false,
        methodUsed: 'extension_api',
        error: 'Account appears deactivated or missing',
      };
    }
    if (payload?.verifyBeforeUnfollow && probe.followsYou === true) {
      return {
        ok: false,
        username,
        verifiedFollowing: probe.youFollow,
        methodUsed: 'extension_api',
        error: 'Pre-flight check detected this account actually follows you back — skipped unfollow.',
      };
    }
    if (probe.youFollow === false) {
      return {
        ok: true,
        username,
        verifiedFollowing: false,
        methodUsed: 'extension_api',
      };
    }
    userId = probe.userId || userId;
  }

  if (userId) {
    const destroyRes = await igFetchJson(
      `https://www.instagram.com/api/v1/friendships/destroy/${encodeURIComponent(userId)}/`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `user_id=${encodeURIComponent(userId)}`,
      },
    );

    if (destroyRes.rateLimited) {
      return {
        ok: false,
        username,
        methodUsed: 'extension_api',
        rateLimited: true,
        error: destroyRes.error,
      };
    }

    if (
      destroyRes.ok &&
      destroyRes.data?.status === 'ok' &&
      destroyRes.data?.friendship_status?.following === false
    ) {
      return {
        ok: true,
        username,
        verifiedFollowing: false,
        methodUsed: 'extension_api',
      };
    }
  }

  if (payload?.useDomFallback) {
    return unfollowViaWorkerTabDom(username);
  }

  return {
    ok: false,
    username,
    methodUsed: 'extension_api',
    error: 'Instagram destroy endpoint did not confirm unfollow; enable DOM fallback or use Guided Cockpit.',
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'POPUP_GET_STATE') {
    pingSession().then((session) => sendResponse({ session, activeJobState }));
    return true;
  }

  if (msg?.type === 'POPUP_ABORT') {
    abortRequested = true;
    updateJobState({ running: false, phase: 'idle', message: 'Aborted from popup' }).then(() =>
      sendResponse({ ok: true }),
    );
    return true;
  }

  if (msg?.type !== 'AUDITOR_COMMAND') return false;

  const tabId = sender.tab?.id;

  (async () => {
    try {
      switch (msg.action) {
        case 'PING':
          sendResponse({ ok: true, payload: await pingSession() });
          break;
        case 'SYNC_GRAPH':
          sendResponse({ ok: true, payload: await handleSyncGraph(msg.payload, tabId) });
          break;
        case 'FACT_CHECK_ACCOUNTS':
          sendResponse({ ok: true, payload: await handleFactCheckAccounts(msg.payload, tabId) });
          break;
        case 'UNFOLLOW_ACCOUNT':
          sendResponse({ ok: true, payload: await handleUnfollowAccount(msg.payload) });
          break;
        case 'ABORT_JOB':
          abortRequested = true;
          await updateJobState({ running: false, phase: 'idle', message: 'Aborted by dashboard' });
          sendResponse({ ok: true, payload: { aborted: true } });
          break;
        default:
          sendResponse({ ok: false, error: `Unknown action: ${msg.action}` });
      }
    } catch (err) {
      await updateJobState({ running: false, phase: 'idle', message: 'Error' });
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  return true;
});
