import { ingestRawFiles } from './parsers/ingestEngine';
import type { ExportSnapshot, LiveGraphPayload, LiveProbeResult } from './types';

function daysAgo(days: number): number {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function formatMetaHtmlDate(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function makeHtmlCard(username: string, ms: number): string {
  return `<div class="pam _3-95 _2ph- _a6-g uiBoxWhite noborder"><div class="_a6-p"><div><div><a target="_blank" href="https://www.instagram.com/_u/${username}">${username}</a></div><div>${formatMetaHtmlDate(ms)}</div></div></div></div>`;
}

/**
 * Generates a realistic 35-day-old Instagram HTML+JSON export along with simulated live drift
 * so anyone opening the GitHub Pages site can test every feature immediately without uploading personal files.
 */
export async function createDemoScenario(): Promise<{
  snapshot: ExportSnapshot;
  olderSnapshot: ExportSnapshot;
  simulatedLiveGraph: LiveGraphPayload;
  simulatedProbes: Record<string, LiveProbeResult>;
}> {
  const mutuals = [
    ['maya_lin', 420],
    ['dev_kiran', 380],
    ['studio_okamoto', 310],
    ['lucas.bakes', 240],
    ['nina.photo', 190],
    ['alex_roam', 150],
    ['taro_beats', 95],
    ['sana.reads', 60],
  ] as const;

  const nonFollowers = [
    ['growth_hustle_daily', 510],
    ['minimal.desks', 460],
    ['coffee_lab_nyc', 390],
    ['vintage.optics', 340],
    ['crypto_alpha_club', 290],
    ['sunset.archive', 220],
    ['already_unfollowed_by_you', 180],
    ['recently_followed_back_you', 140],
    ['ghost_deactivated_99', 110],
    ['open_ai_notes', 45],
    ['new_brand_drop', 3],
  ] as const;

  const fans = [
    ['indie_zine_club', 270],
    ['arjun.sketches', 165],
    ['film.grain.tokyo', 80],
  ] as const;

  const pending = [
    ['private_chef_dan', 72],
    ['quiet.ceramics', 12],
  ] as const;

  const closeFriends = ['maya_lin', 'dev_kiran', 'open_ai_notes'];

  const followersHtml = `<!DOCTYPE html><html><head><title>Followers</title></head><body><h1>Followers</h1>${[
    ...mutuals,
    ...fans,
  ]
    .map(([u, d]) => makeHtmlCard(u, daysAgo(d)))
    .join('\n')}</body></html>`;

  const followingHtml = `<!DOCTYPE html><html><head><title>Following</title></head><body><h1>Following</h1>${[
    ...mutuals,
    ...nonFollowers,
  ]
    .map(([u, d]) => makeHtmlCard(u, daysAgo(d)))
    .join('\n')}</body></html>`;

  const pendingHtml = `<!DOCTYPE html><html><head><title>Pending follow requests</title></head><body><h1>Pending follow requests</h1>${pending
    .map(([u, d]) => makeHtmlCard(u, daysAgo(d)))
    .join('\n')}</body></html>`;

  const closeFriendsJson = JSON.stringify({
    relationships_close_friends: closeFriends.map((u) => ({
      title: '',
      string_list_data: [
        {
          href: `https://www.instagram.com/${u}`,
          value: u,
          timestamp: Math.floor(daysAgo(200) / 1000),
        },
      ],
    })),
  });

  const personalJson = JSON.stringify({
    profile_user: [
      {
        string_map_data: {
          Username: { value: 'demo_creator' },
        },
      },
    ],
  });

  const snapshot = await ingestRawFiles(
    [
      {
        name: 'followers_1.html',
        path: 'connections/followers_and_following/followers_1.html',
        content: followersHtml,
        lastModified: daysAgo(35),
      },
      {
        name: 'following.html',
        path: 'connections/followers_and_following/following.html',
        content: followingHtml,
        lastModified: daysAgo(35),
      },
      {
        name: 'pending_follow_requests.html',
        path: 'connections/followers_and_following/pending_follow_requests.html',
        content: pendingHtml,
        lastModified: daysAgo(35),
      },
      {
        name: 'close_friends.json',
        path: 'connections/followers_and_following/close_friends.json',
        content: closeFriendsJson,
        lastModified: daysAgo(35),
      },
      {
        name: 'personal_information.json',
        path: 'personal_information/personal_information/personal_information.json',
        content: personalJson,
        lastModified: daysAgo(35),
      },
    ],
    {
      label: 'Demo Export (@demo_creator — 35d ago)',
      sourceKind: 'demo',
    },
  );
  snapshot.exportGeneratedAt = daysAgo(35);

  // Older historical export (90d ago) for Timeline Compare demo
  const olderFollowersHtml = `<!DOCTYPE html><html><head><title>Followers</title></head><body>${[
    ...mutuals,
    ['former_follower_lee', 210] as const,
  ]
    .map(([u, d]) => makeHtmlCard(u, daysAgo(d)))
    .join('\n')}</body></html>`;

  const olderSnapshot = await ingestRawFiles(
    [
      {
        name: 'followers_1.html',
        path: 'connections/followers_and_following/followers_1.html',
        content: olderFollowersHtml,
        lastModified: daysAgo(90),
      },
      {
        name: 'following.html',
        path: 'connections/followers_and_following/following.html',
        content: followingHtml,
        lastModified: daysAgo(90),
      },
    ],
    {
      label: 'Demo Export (@demo_creator — 90d ago)',
      sourceKind: 'demo',
    },
  );
  olderSnapshot.exportGeneratedAt = daysAgo(90);

  // Simulated Live Reality showing why fact-checking an old export matters!
  const simulatedLiveGraph: LiveGraphPayload = {
    source: 'extension',
    ownerUsername: 'demo_creator',
    capturedAt: Date.now(),
    completeFollowers: true,
    completeFollowing: true,
    followers: [
      ...mutuals.map(([u]) => ({ username: u, profileUrl: `https://www.instagram.com/${u}/` })),
      ...fans.map(([u]) => ({ username: u, profileUrl: `https://www.instagram.com/${u}/` })),
      {
        username: 'recently_followed_back_you',
        profileUrl: 'https://www.instagram.com/recently_followed_back_you/',
      },
    ],
    following: [
      ...mutuals.map(([u]) => ({ username: u, profileUrl: `https://www.instagram.com/${u}/` })),
      ...nonFollowers
        .filter(([u]) => u !== 'already_unfollowed_by_you' && u !== 'ghost_deactivated_99')
        .map(([u]) => ({ username: u, profileUrl: `https://www.instagram.com/${u}/` })),
      {
        username: 'brand_new_post_export_follow',
        profileUrl: 'https://www.instagram.com/brand_new_post_export_follow/',
      },
    ],
  };

  const simulatedProbes: Record<string, LiveProbeResult> = {
    ghost_deactivated_99: {
      username: 'ghost_deactivated_99',
      normalizedUsername: 'ghost_deactivated_99',
      accountExists: false,
      youFollow: false,
      followsYou: false,
      checkedAt: Date.now(),
      method: 'extension',
    },
    'minimal.desks': {
      username: 'minimal.desks',
      normalizedUsername: 'minimal.desks',
      fullName: 'Minimal Desks Studio',
      isVerified: true,
      followerCount: 148000,
      followingCount: 112,
      accountExists: true,
      youFollow: true,
      followsYou: false,
      checkedAt: Date.now(),
      method: 'extension',
    },
  };

  return { snapshot, olderSnapshot, simulatedLiveGraph, simulatedProbes };
}
