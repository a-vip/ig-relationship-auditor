import { describe, expect, it } from 'vitest';
import { ingestRawFiles } from '../src/core/parsers/ingestEngine';
import {
  buildEnrichedAccounts,
  diffSnapshots,
  filterAccountsBySegment,
  summarizeReconciliation,
} from '../src/core/reconciliation/engine';
import { DEFAULT_PROTECTION_CONFIG } from '../src/core/reconciliation/safetyRules';
import { parseDevToolsImport } from '../src/core/transports/devToolsScript';

describe('reconciliation, live fact-checking, timeline diff, and smart rules', () => {
  it('reconciles outdated export against live reality (detecting stale unfollows, new mutuals, and missing accounts)', async () => {
    const oldFollowTs = Math.floor((Date.now() - 40 * 86_400_000) / 1000);
    const recentFollowTs = Math.floor((Date.now() - 2 * 86_400_000) / 1000);

    const snapshot = await ingestRawFiles([
      {
        name: 'followers_1.json',
        path: 'followers_1.json',
        content: JSON.stringify([
          { string_list_data: [{ value: 'mutual_pal', timestamp: oldFollowTs }] },
          { string_list_data: [{ value: 'fan_only', timestamp: oldFollowTs }] },
        ]),
      },
      {
        name: 'following.json',
        path: 'following.json',
        content: JSON.stringify({
          relationships_following: [
            { title: 'mutual_pal', string_list_data: [{ timestamp: oldFollowTs }] },
            { title: 'true_non_follower', string_list_data: [{ timestamp: oldFollowTs }] },
            { title: 'already_unfollowed_stale', string_list_data: [{ timestamp: oldFollowTs }] },
            { title: 'now_mutual_user', string_list_data: [{ timestamp: oldFollowTs }] },
            { title: 'deactivated_user', string_list_data: [{ timestamp: oldFollowTs }] },
            { title: 'new_grace_follow', string_list_data: [{ timestamp: recentFollowTs }] },
          ],
        }),
      },
      {
        name: 'close_friends.json',
        path: 'close_friends.json',
        content: JSON.stringify({
          relationships_close_friends: [{ string_list_data: [{ value: 'true_non_follower' }] }],
        }),
      },
    ]);

    const enriched = buildEnrichedAccounts({
      snapshot,
      liveGraph: {
        source: 'extension',
        capturedAt: Date.now(),
        completeFollowers: true,
        completeFollowing: true,
        followers: [
          { username: 'mutual_pal', profileUrl: 'https://www.instagram.com/mutual_pal/' },
          { username: 'fan_only', profileUrl: 'https://www.instagram.com/fan_only/' },
          { username: 'now_mutual_user', profileUrl: 'https://www.instagram.com/now_mutual_user/' },
        ],
        following: [
          { username: 'mutual_pal', profileUrl: 'https://www.instagram.com/mutual_pal/' },
          { username: 'true_non_follower', profileUrl: 'https://www.instagram.com/true_non_follower/' },
          { username: 'now_mutual_user', profileUrl: 'https://www.instagram.com/now_mutual_user/' },
          { username: 'new_grace_follow', profileUrl: 'https://www.instagram.com/new_grace_follow/' },
        ],
      },
      liveProbes: {
        deactivated_user: {
          username: 'deactivated_user',
          normalizedUsername: 'deactivated_user',
          accountExists: false,
          youFollow: false,
          followsYou: false,
          checkedAt: Date.now(),
          method: 'extension',
        },
      },
      protectionConfig: { ...DEFAULT_PROTECTION_CONFIG, gracePeriodDays: 7 },
    });

    const byName = new Map(enriched.map((a) => [a.username, a]));
    expect(byName.get('mutual_pal')?.verificationStatus).toBe('verified_mutual');
    expect(byName.get('true_non_follower')?.verificationStatus).toBe('confirmed_not_following_back');
    expect(byName.get('true_non_follower')?.protectedByRule).toBe('Close Friends list');
    expect(byName.get('already_unfollowed_stale')?.verificationStatus).toBe('already_unfollowed');
    expect(byName.get('now_mutual_user')?.verificationStatus).toBe('actually_follows_back');
    expect(byName.get('deactivated_user')?.verificationStatus).toBe('deactivated_or_missing');
    expect(byName.get('new_grace_follow')?.protectedByRule).toBe('Followed < 7d ago');

    const summary = summarizeReconciliation(enriched);
    expect(summary.confirmedNotFollowingBack).toBe(2); // true_non_follower + new_grace_follow
    expect(summary.alreadyUnfollowed).toBe(1);
    expect(summary.nowFollowsBack).toBe(1);
    expect(summary.deactivatedOrMissing).toBe(1);

    expect(filterAccountsBySegment(enriched, 'fans').map((a) => a.username)).toEqual(['fan_only']);
  });

  it('diffs two snapshots chronologically to detect lost and gained followers', async () => {
    const snapA = await ingestRawFiles([
      {
        name: 'followers_1.json',
        path: 'followers_1.json',
        content: JSON.stringify([
          { string_list_data: [{ value: 'stay_pal' }] },
          { string_list_data: [{ value: 'unfollowed_me' }] },
        ]),
      },
      {
        name: 'following.json',
        path: 'following.json',
        content: JSON.stringify({
          relationships_following: [{ title: 'stay_pal', string_list_data: [{}] }],
        }),
      },
    ]);

    const snapB = await ingestRawFiles([
      {
        name: 'followers_1.json',
        path: 'followers_1.json',
        content: JSON.stringify([
          { string_list_data: [{ value: 'stay_pal' }] },
          { string_list_data: [{ value: 'brand_new_fan' }] },
        ]),
      },
      {
        name: 'following.json',
        path: 'following.json',
        content: JSON.stringify({
          relationships_following: [
            { title: 'stay_pal', string_list_data: [{}] },
            { title: 'newly_followed', string_list_data: [{}] },
          ],
        }),
      },
    ]);

    const diff = diffSnapshots(snapA, snapB);
    expect(diff.lostFollowers.map((e) => e.username)).toEqual(['unfollowed_me']);
    expect(diff.gainedFollowers.map((e) => e.username)).toEqual(['brand_new_fan']);
    expect(diff.newFollowings.map((e) => e.username)).toEqual(['newly_followed']);
  });

  it('parses DevTools live-sync JSON imports for both full graph and targeted probes', () => {
    const graphRes = parseDevToolsImport(
      JSON.stringify({
        kind: 'ig_auditor_live_graph',
        followers: [{ username: 'alice' }],
        following: [{ username: 'alice' }, { username: 'bob' }],
      }),
    );
    expect(graphRes.type).toBe('live_graph');

    const probeRes = parseDevToolsImport(
      JSON.stringify({
        kind: 'ig_auditor_probes',
        probes: [{ username: 'bob', accountExists: true, youFollow: true, followsYou: false }],
      }),
    );
    expect(probeRes.type).toBe('probes');
  });
});
