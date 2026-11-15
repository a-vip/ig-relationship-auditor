# System Architecture — IG Relationship Auditor

## Design Goals

1. **Zero-Server Privacy First**: All data-download parsing, graph computation, whitelist management, and historical snapshots stay strictly inside the user's browser (`IndexedDB`) on GitHub Pages (`https://a-vip.github.io/ig-relationship-auditor/`).
2. **Universal Format Support**: Handles Meta Accounts Center HTML exports (`pam _a6-g`, `_u/` links, localized dates), modern and legacy JSON schemas (`followers_1..N.json`, `title`-only `following.json`, `relationships_*` wrappers, Mojibake UTF-8 strings), CSV/TXT lists, extracted folders, and gigabyte-scale ZIP archives (via selective `fflate` decompression that skips `media/`, `messages/`, and `reels/`).
3. **Honest Browser Security Handling (Why Hybrid Transports Exist)**:
   Browsers enforce Same-Origin Policy and CORS, which prevents any static GitHub Pages site from silently reading `instagram.com` cookies or calling `instagram.com/api/v1/*` directly across origins.
   To enable **real automated fact-checking** and **in-system unfollowing** without uploading credentials to a remote third-party backend, the system implements a unified `LiveVerifierTransport` contract across four progressively capable tiers:

| Tier | Component | Install Required? | Capabilities |
| :--- | :--- | :--- | :--- |
| **1. Guided Cockpit & DevTools Sync** | `src/core/transports/devToolsScript.ts` + `UnfollowCockpit.tsx` | None (GitHub Pages only) | Zero-install console snippet pulls live followers/following or probes; reusable side-by-side popup cockpit (`O/U/W/S/J/K`) keeps unfollowing inside one streamlined workflow. |
| **2. Bundled Browser Extension (MV3)** | `extension/` (`ig-auditor-extension.zip`) | Load unpacked in Chrome/Edge | Bridges `window.postMessage` <-> `chrome.runtime` using the browser's existing `instagram.com` session. Supports 1-click full sync, targeted batch verification, API unfollow + DOM worker-tab fallback. Never exposes `sessionid` cookies to web pages. |
| **3. Local Playwright Companion & CLI** | `companion/` (`127.0.0.1:47831`) | Local Node.js + Playwright | Token-authenticated (`X-Auditor-Token`) local HTTP bridge driving a persistent Chromium profile for headless or headed API + real DOM verification/unfollow and scheduled CLI audits. |
| **4. Snapshot & Export Diff Engine** | `src/core/reconciliation/engine.ts` | None | Compares outdated exports against live state (`confirmed_not_following_back`, `already_unfollowed`, `actually_follows_back`, `deactivated_or_missing`) and compares two exports chronologically. |

## Safety Guardrails

- **Strict JSON Validation**: All API transports verify `Content-Type: application/json` and explicit JSON status fields so HTML login/checkpoint pages with HTTP 200 are never misinterpreted as success.
- **Rate-Limit Circuit Breaker**: HTTP `429` or `challenge_required` immediately pauses active loops.
- **Pre-Flight Verification & Smart Protection**: Close Friends, Favorites, Verified accounts (optional), new-follow grace periods, protected tags, custom regex exclusions, and manually whitelisted handles are automatically shielded from the unfollow queue.
- **Rolling 24h Quota & Humanized Jitter**: Configurable randomized wait intervals and persistent 24-hour action caps stored in `IndexedDB`.
