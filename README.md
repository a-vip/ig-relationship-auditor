# IG Relationship Auditor

[![Live on GitHub Pages](https://img.shields.io/badge/Live%20App-GitHub%20Pages-06b6d4?style=for-the-badge)](https://a-vip.github.io/ig-relationship-auditor/)
[![License: MIT](https://img.shields.io/badge/License-MIT-ec4899?style=for-the-badge)](./LICENSE)

**Privacy-first Instagram data-download analyzer, automated live fact-checker, and safety-guarded unfollow workstation — hosted directly on GitHub Pages.**

Open it directly in your browser at **[https://a-vip.github.io/ig-relationship-auditor/](https://a-vip.github.io/ig-relationship-auditor/)** — your data exports, notes, whitelists, and audit logs never leave your machine.

---

## Core Capabilities

### 1. Universal Instagram Export Ingestion (100% Client-Side)
- Accepts **`.zip` archives**, **extracted export folders** (drag-and-drop directory trees or folder picker), **multi-file uploads**, or **raw pasted data**.
- **Selective ZIP Extraction**: Streams/filters ZIP archives in-browser via `fflate` and automatically skips heavy `media/`, `messages/`, and `reels/` binary assets so even multi-gigabyte downloads parse in seconds.
- **Format-Agnostic Parsing**:
  - **HTML Exports** (`followers_1.html`, `following.html`, `pending_follow_requests.html`, etc.): Meta Accounts Center card DOM (`pam _a6-g`), legacy tables/lists, `_u/` links, and localized date parsing.
  - **JSON Exports** (`followers_1..N.json`, `following.json`, `close_friends.json`, `personal_information.json`): Supports both `string_list_data[].value` and modern `title`-only `following.json`, `relationships_*` wrappers, legacy dictionaries, and UTF-8 Mojibake auto-decoding.
  - **CSV / TSV / Plaintext Lists**.
- **Built-In Sample Demo**: Click **Load Sample Demo** on GitHub Pages to explore a realistic 35-day-old HTML+JSON dataset, 90-day-old baseline diff, and simulated live reality drift without uploading personal files.

### 2. Automated Live Fact-Checking & Stale Export Reconciliation
Static Instagram exports quickly go out of date. Because browsers block cross-origin calls from GitHub Pages directly to `instagram.com`, IG Relationship Auditor provides **three progressive live verification layers** implementing a common `LiveVerifierTransport` contract:

1. **Bundled Chrome/Edge MV3 Browser Extension (`extension/`)**
   - Packaged right in the repo (and downloadable directly inside the GitHub Pages app as `ig-auditor-extension.zip`).
   - Uses your active browser `instagram.com` session (never exposes `sessionid` cookies to web pages) for **1-click Live Graph Sync** and **Targeted Batch Fact-Checking**.
2. **Local Playwright Companion Bridge & CLI (`companion/`)**
   - Authenticated local HTTP bridge (`127.0.0.1:47831` + per-run `X-Auditor-Token`) using a persistent Playwright Chromium profile with API + real DOM verification fallback, plus standalone CLI (`serve`, `login`, `fact-check`).
3. **Zero-Install DevTools Console Live-Sync (`DevToolsSnippetTransport`)**
   - Generates an auditable JS snippet inside the web app to extract live followers/following or targeted profile status from an open `instagram.com` tab and reconcile the pasted JSON against your outdated export.

**Reconciliation automatically distinguishes:**
- **Confirmed Non-Mutuals** (`confirmed_not_following_back`)
- **Stale False Positives** (`already_unfollowed` — you already unfollowed them after the export; `actually_follows_back` — they started following you back!)
- **Deactivated / Missing Profiles** (`deactivated_or_missing`)
- **Renamed Handles** (`handle_changed`)

### 3. In-System Unfollow Cockpit with Safety Guardrails
- **Automated Paced Runner** (via Extension or Playwright Companion): Pre-flight live verification before unfollowing, randomized human-like delay jitter, rolling 24-hour cap persisted in IndexedDB, batch size cap, real-DOM button fallback, and automatic rate-limit circuit breaker (`HTTP 429` / `challenge_required`).
- **Guided Side-by-Side Keyboard Cockpit** (Zero-Install): Works natively on GitHub Pages by opening and reusing a single positioned `igAuditorProfileWindow` beside the dashboard with instant shortcuts (`O` Open/Update profile, `U` Mark unfollowed & next, `W` Whitelist & next, `S`/`J`/`K` Navigate).
- **Smart Auto-Protection Rules**: Automatically shields **Close Friends**, **Favorited Accounts**, **Verified Accounts** (optional), **Recently Followed Grace Period (< N days)**, **Protected Tags**, and **Custom Username Regex**.

### 4. Timeline Diff, Persistence & Extensibility
- **Snapshot Timeline Diff**: Compare any two historical exports (or a promoted Live Sync snapshot) to inspect *Lost Followers*, *Gained Followers*, *New Followings*, and *Removed Followings*.
- **IndexedDB Workspace**: Persists snapshots, whitelists, tags, personal notes, and timestamped Unfollow Audit Ledgers locally, with full JSON Backup/Restore and filtered CSV export.
- **Modular `PluginRegistry`**: Register custom `ExportParserPlugin`, `AnalyzerModule`, and `LiveVerifierTransport` modules cleanly (see [`docs/EXTENDING.md`](./docs/EXTENDING.md) and [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)).

---

## Local Development

```bash
# 1. Run Web App locally
npm install
npm run dev

# 2. Run Typecheck, Tests & Production Build
npm run typecheck
npm test
npm run build

# 3. Optional: Start Local Playwright Companion
cd companion
npm install
npx playwright install chromium
npm run login
npm run serve
```

## Disclaimer
Automated requests to internal Instagram web endpoints are subject to Instagram's rate limits and Terms of Use. Always keep conservative batch caps and delays enabled, or use the zero-risk Guided Keyboard Cockpit.
