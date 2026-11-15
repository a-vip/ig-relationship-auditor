import type { RelationshipCategory } from '../types';

const PATH_RULES: Array<{ pattern: RegExp; category: RelationshipCategory | 'personal_info' | 'ignored' }> = [
  { pattern: /(?:^|\/)followers(?:_\d+)?\.(html?|json|csv|txt)$/i, category: 'followers' },
  { pattern: /(?:^|\/)relationships_followers/i, category: 'followers' },
  { pattern: /(?:^|\/)following(?:_\d+)?\.(html?|json|csv|txt)$/i, category: 'following' },
  { pattern: /(?:^|\/)accounts_you(?:'|’)?ve_followed/i, category: 'following' },
  { pattern: /(?:^|\/)pending_follow_requests(?:_\d+)?\./i, category: 'pending_requests' },
  { pattern: /follow_requests_you(?:'|’)?ve_sent/i, category: 'pending_requests' },
  { pattern: /(?:^|\/)recent_follow_requests(?:_\d+)?\./i, category: 'recent_requests' },
  { pattern: /(?:^|\/)recently_unfollowed_profiles(?:_\d+)?\./i, category: 'recently_unfollowed' },
  { pattern: /unfollowed_profiles/i, category: 'recently_unfollowed' },
  { pattern: /(?:^|\/)close_friends(?:_\d+)?\./i, category: 'close_friends' },
  { pattern: /accounts_you(?:'|’)?ve_favorited/i, category: 'favorites' },
  { pattern: /favorited_profiles/i, category: 'favorites' },
  { pattern: /(?:^|\/)blocked_profiles(?:_\d+)?\./i, category: 'blocked' },
  { pattern: /(?:^|\/)blocked_accounts(?:_\d+)?\./i, category: 'blocked' },
  { pattern: /(?:^|\/)restricted_profiles(?:_\d+)?\./i, category: 'restricted' },
  { pattern: /(?:^|\/)hide_story_from(?:_\d+)?\./i, category: 'restricted' },
  { pattern: /(?:^|\/)personal_information(?:_\d+)?\./i, category: 'personal_info' },
  { pattern: /(?:^|\/)(?:index|start_here|readme|about_your_data)\.(html?|txt|md)$/i, category: 'ignored' },
  { pattern: /removed_suggestions|dismissed_suggested|suggested_profiles_viewed/i, category: 'ignored' },
];

export function classifyPath(filePath: string): RelationshipCategory | 'personal_info' | 'ignored' | 'unknown' {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const baseName = normalized.split('/').pop() || normalized;

  // Ignore non-relationship heavy sections if someone drops an entire root folder
  if (
    /(^|\/)(media|messages|inbox|your_instagram_activity\/likes|your_instagram_activity\/comments|logged_information|ads_information|apps_and_websites_off_of_instagram)\//.test(
      normalized,
    )
  ) {
    return 'ignored';
  }

  for (const rule of PATH_RULES) {
    if (rule.pattern.test(normalized) || rule.pattern.test(baseName)) {
      return rule.category;
    }
  }

  return 'unknown';
}

export function classifyByJsonRootKey(key: string): RelationshipCategory | 'personal_info' | 'unknown' {
  const k = key.toLowerCase();
  if (k === 'relationships_followers' || k === 'followers') return 'followers';
  if (k === 'relationships_following' || k === 'following') return 'following';
  if (k === 'relationships_follow_requests_sent' || k === 'pending_follow_requests') return 'pending_requests';
  if (k === 'relationships_permanent_follow_requests' || k === 'recent_follow_requests') return 'recent_requests';
  if (k === 'relationships_unfollowed_users' || k === 'recently_unfollowed_profiles') return 'recently_unfollowed';
  if (k === 'relationships_close_friends' || k === 'close_friends') return 'close_friends';
  if (k === 'relationships_favorited_users' || k === 'favorites') return 'favorites';
  if (k === 'relationships_blocked_users' || k === 'blocked_profiles') return 'blocked';
  if (
    k === 'relationships_restricted_users' ||
    k === 'relationships_hide_stories_from' ||
    k === 'restricted_profiles'
  ) {
    return 'restricted';
  }
  if (k === 'profile_user') return 'personal_info';
  return 'unknown';
}

export function classifyByHtmlHeading(text: string): RelationshipCategory | 'personal_info' | 'unknown' {
  const lower = text.toLowerCase();
  if (/\bpending follow requests\b|\bfollow requests you(?:'|’)?ve sent\b/.test(lower)) return 'pending_requests';
  if (/\brecent follow requests\b/.test(lower)) return 'recent_requests';
  if (/\brecently unfollowed\b/.test(lower)) return 'recently_unfollowed';
  if (/\bclose friends\b/.test(lower)) return 'close_friends';
  if (/\bfavorited\b/.test(lower)) return 'favorites';
  if (/\bblocked\b/.test(lower)) return 'blocked';
  if (/\brestricted\b|\bhide story from\b/.test(lower)) return 'restricted';
  if (/\bfollowing\b|\baccounts you follow\b/.test(lower)) return 'following';
  if (/\bfollowers\b/.test(lower)) return 'followers';
  if (/\bpersonal information\b|\bprofile information\b/.test(lower)) return 'personal_info';
  return 'unknown';
}
