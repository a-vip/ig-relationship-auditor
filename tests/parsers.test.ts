import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ingestRawFiles, ingestUploadedFiles } from '../src/core/parsers/ingestEngine';
import { decodeMetaMojibake, extractUsernameFromHref, parseTimestamp } from '../src/core/parsers/normalize';

describe('normalization helpers', () => {
  it('extracts usernames from standard, _u/, mobile, and query-param Instagram URLs while ignoring non-profile routes', () => {
    expect(extractUsernameFromHref('https://www.instagram.com/alice.dev/')).toBe('alice.dev');
    expect(extractUsernameFromHref('https://www.instagram.com/_u/bob_studio?igsh=123')).toBe('bob_studio');
    expect(extractUsernameFromHref('https://m.instagram.com/@charlie_99')).toBe('charlie_99');
    expect(extractUsernameFromHref('https://www.instagram.com/explore/tags/art/')).toBeNull();
    expect(extractUsernameFromHref('https://www.instagram.com/p/Cxyz123/')).toBeNull();
  });

  it('decodes Meta Latin-1 UTF-8 mojibake safely without breaking regular text', () => {
    expect(decodeMetaMojibake('Jos\u00c3\u00a9')).toBe('José');
    expect(decodeMetaMojibake('normal_user')).toBe('normal_user');
  });

  it('parses Unix seconds, ms, and Meta HTML localized date strings', () => {
    expect(parseTimestamp(1736940240)).toBe(1736940240000);
    expect(parseTimestamp(1736940240000)).toBe(1736940240000);
    const ms = parseTimestamp('Jan 15, 2025, 4:32 PM');
    expect(ms).toBeGreaterThan(1700000000000);
  });
});

describe('HTML, JSON, CSV, and ZIP export parsers', () => {
  it('parses Meta Accounts Center HTML followers & following files including _u/ links and dates', async () => {
    const followersHtml = `
      <!doctype html>
      <html><head><title>Followers</title></head><body>
        <div class="pam _3-95 _2ph- _a6-g uiBoxWhite noborder">
          <div class="_a6-p"><div>
            <div><a href="https://www.instagram.com/_u/mutual_friend">mutual_friend</a></div>
            <div>Jan 15, 2025, 4:32 PM</div>
          </div></div>
        </div>
        <div class="pam _3-95 _2ph- _a6-g uiBoxWhite noborder">
          <div class="_a6-p"><div>
            <div><a href="https://www.instagram.com/only_fan">only_fan</a></div>
            <div>Feb 02, 2025, 9:10 AM</div>
          </div></div>
        </div>
      </body></html>
    `;

    const followingHtml = `
      <!doctype html>
      <html><head><title>Following</title></head><body>
        <table>
          <tr><td><a href="https://www.instagram.com/mutual_friend">mutual_friend</a></td><td>Jan 10, 2025</td></tr>
          <tr><td><a href="https://www.instagram.com/_u/not_following_back">not_following_back</a></td><td>Dec 12, 2024</td></tr>
        </table>
      </body></html>
    `;

    const personalHtml = `
      <!doctype html><html><body><table><tr><td>Username</td><td>@my_ig_handle</td></tr></table></body></html>
    `;

    const snap = await ingestRawFiles([
      {
        name: 'followers_1.html',
        path: 'connections/followers_and_following/followers_1.html',
        content: followersHtml,
      },
      {
        name: 'following.html',
        path: 'connections/followers_and_following/following.html',
        content: followingHtml,
      },
      {
        name: 'personal_information.html',
        path: 'personal_information/personal_information/personal_information.html',
        content: personalHtml,
      },
    ]);

    expect(snap.sourceFormat).toBe('html');
    expect(snap.ownerUsername).toBe('my_ig_handle');
    expect(snap.datasets.followers.map((x) => x.username).sort()).toEqual([
      'mutual_friend',
      'only_fan',
    ]);
    expect(snap.datasets.following.map((x) => x.username).sort()).toEqual([
      'mutual_friend',
      'not_following_back',
    ]);
    expect(snap.datasets.followers[0].timestamp).toBeGreaterThan(1700000000000);
  });

  it('parses modern title-only following.json, multi-part followers_1..2.json, and pending requests', async () => {
    const f1 = JSON.stringify([
      { string_list_data: [{ href: 'https://www.instagram.com/alice', value: 'alice', timestamp: 1700000000 }] },
    ]);
    const f2 = JSON.stringify([
      { string_list_data: [{ href: 'https://www.instagram.com/bob', value: 'bob', timestamp: 1700000100 }] },
    ]);
    const following = JSON.stringify({
      relationships_following: [
        {
          title: 'alice',
          string_list_data: [{ href: 'https://www.instagram.com/_u/alice', timestamp: 1700000200 }],
        },
        {
          title: 'celebrity_x',
          string_list_data: [{ href: 'https://www.instagram.com/_u/celebrity_x', timestamp: 1700000300 }],
        },
      ],
    });
    const pending = JSON.stringify({
      relationships_follow_requests_sent: [
        { string_list_data: [{ href: 'https://www.instagram.com/private_user', value: 'private_user', timestamp: 1700000400 }] },
      ],
    });

    const snap = await ingestRawFiles([
      { name: 'followers_1.json', path: 'followers_1.json', content: f1 },
      { name: 'followers_2.json', path: 'followers_2.json', content: f2 },
      { name: 'following.json', path: 'following.json', content: following },
      { name: 'pending_follow_requests.json', path: 'pending_follow_requests.json', content: pending },
    ]);

    expect(snap.sourceFormat).toBe('json');
    expect(snap.datasets.followers.map((u) => u.username).sort()).toEqual(['alice', 'bob']);
    expect(snap.datasets.following.map((u) => u.username).sort()).toEqual(['alice', 'celebrity_x']);
    expect(snap.datasets.pending_requests.map((u) => u.username)).toEqual(['private_user']);
  });

  it('selectively unpacks ZIP archives while skipping media binaries', async () => {
    const zipped = zipSync({
      'connections/followers_and_following/followers_1.json': strToU8(
        JSON.stringify([{ string_list_data: [{ value: 'zip_mutual', timestamp: 1710000000 }] }]),
      ),
      'connections/followers_and_following/following.html': strToU8(
        '<html><body><a href="https://www.instagram.com/zip_mutual">zip_mutual</a><a href="https://www.instagram.com/zip_non_mutual">zip_non_mutual</a></body></html>',
      ),
      'media/posts/202501/photo.jpg': new Uint8Array([0xff, 0xd8, 0xff]),
    });

    const zipFile = new File([zipped], 'instagram-export.zip', { type: 'application/zip' });
    const snap = await ingestUploadedFiles([zipFile]);

    expect(snap.sourceKind).toBe('export_zip');
    expect(snap.sourceFormat).toBe('mixed');
    expect(snap.datasets.followers.map((u) => u.username)).toEqual(['zip_mutual']);
    expect(snap.datasets.following.map((u) => u.username).sort()).toEqual([
      'zip_mutual',
      'zip_non_mutual',
    ]);
    expect(snap.skippedFilesCount).toBeGreaterThanOrEqual(1);
  });

  it('parses CSV/TXT handle lists cleanly', async () => {
    const csv = 'username,timestamp\n@csv_user_1,1710000000\ncsv_user_2,2025-01-01T00:00:00Z\n';
    const snap = await ingestRawFiles([
      { name: 'following.csv', path: 'following.csv', content: csv },
    ]);
    expect(snap.datasets.following.map((u) => u.username)).toEqual(['csv_user_1', 'csv_user_2']);
  });
});
