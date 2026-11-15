# Extending IG Relationship Auditor

The application is built around a typed `PluginRegistry` (`src/core/plugins/registry.ts`) and modular transport interface (`src/core/transports/types.ts`) so new platforms, file layouts, insight rules, and live transports can be added cleanly without rewriting core UI or storage code.

## 1. Adding a New Export Parser Plugin

Create a module implementing `ExportParserPlugin` (for example, to parse Threads, TikTok, or X/Twitter relationship exports):

```ts
import type { ExportParserPlugin, ParserInputFile, ParsedFileResult } from '../plugins/registry';

export const threadsExportParser: ExportParserPlugin = {
  id: 'threads-json-parser',
  name: 'Threads JSON Export Parser',
  version: '1.0.0',
  description: 'Parses Threads followers/following JSON exports.',
  priority: 85,
  canParse(file: ParserInputFile): boolean {
    return file.path.toLowerCase().includes('threads') && file.name.endsWith('.json');
  },
  parse(file: ParserInputFile): ParsedFileResult {
    // Parse file.content into AccountEntry[]
    return {
      category: 'followers',
      entries: [],
      format: 'json',
    };
  },
};
```

Register it alongside built-in parsers inside `ensureBuiltinParsersRegistered()` in `src/core/parsers/ingestEngine.ts`:

```ts
registry.registerParser(threadsExportParser);
```

## 2. Adding a New Analyzer Module

Create an `AnalyzerModule` in `src/core/plugins/builtinAnalyzers.ts` (or a new file imported there):

```ts
import type { AnalyzerContext, AnalyzerModule } from './registry';
import type { AnalyzerInsight } from '../types';

export const lowMutualRatioAnalyzer: AnalyzerModule = {
  id: 'analyzer-low-mutual-ratio',
  name: 'Mutual Reciprocity Health Check',
  version: '1.0.0',
  description: 'Flags accounts when mutual reciprocity falls below 50%.',
  defaultEnabled: true,
  analyze(ctx: AnalyzerContext): AnalyzerInsight[] {
    const following = ctx.accounts.filter((a) => a.isFollowing).length;
    const mutuals = ctx.accounts.filter((a) => a.isMutual).length;
    if (following > 20 && mutuals / following < 0.5) {
      return [
        {
          id: 'low-mutual-ratio',
          moduleId: this.id,
          severity: 'warning',
          title: 'Low Mutual Reciprocity',
          summary: `Only ${Math.round((mutuals / following) * 100)}% of accounts you follow follow back.`,
          filterSegment: 'not_following_back',
        },
      ];
    }
    return [];
  },
};
```

Register it in `ensureBuiltinAnalyzersRegistered()`, and it automatically appears in both **Overview Insights** and the **Modules & Setup** toggle table!

## 3. Adding a New Live Transport Adapter

Implement `LiveVerifierTransport` from `src/core/transports/types.ts`:
- `ping()`
- `syncLiveGraph(onProgress, options)`
- `factCheckAccounts(targets, onProgress, options)`
- `unfollowAccount(target, safetyConfig)`
- `abort()`

This lets you plug in custom Playwright workflows, remote private runners, or new platform APIs while preserving the exact same reconciliation engine and safety cockpit UI.
