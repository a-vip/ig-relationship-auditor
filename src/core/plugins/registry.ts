import type {
  AccountEntry,
  AnalyzerInsight,
  EnrichedAccount,
  ExportSnapshot,
  RelationshipCategory,
  SafetyConfig,
  SmartProtectionConfig,
  VerificationStatus,
} from '../types';

export interface ParserInputFile {
  name: string;
  path: string;
  content: string;
  lastModified?: number;
}

export interface ParsedFileResult {
  category: RelationshipCategory | 'personal_info' | 'ignored';
  entries: AccountEntry[];
  extraDatasets?: Partial<Record<RelationshipCategory, AccountEntry[]>>;
  ownerUsername?: string;
  format: 'html' | 'json' | 'csv' | 'txt';
  warnings?: string[];
}

export interface ExportParserPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  priority: number;
  canParse(file: ParserInputFile): boolean;
  parse(file: ParserInputFile): ParsedFileResult;
}

export interface AnalyzerContext {
  snapshot: ExportSnapshot;
  accounts: EnrichedAccount[];
  protectionConfig: SmartProtectionConfig;
  safetyConfig: SafetyConfig;
  actionsLast24h: number;
  verificationCounts: Record<VerificationStatus, number>;
}

export interface AnalyzerModule {
  id: string;
  name: string;
  version: string;
  description: string;
  defaultEnabled: boolean;
  analyze(context: AnalyzerContext): AnalyzerInsight[];
}

export interface WorkspaceModuleDescriptor {
  id: string;
  name: string;
  kind: 'parser' | 'analyzer' | 'transport';
  version: string;
  description: string;
  enabled: boolean;
}

export class PluginRegistry {
  private parsers: ExportParserPlugin[] = [];
  private analyzers: AnalyzerModule[] = [];
  private enabledAnalyzers = new Set<string>();

  registerParser(plugin: ExportParserPlugin): void {
    const idx = this.parsers.findIndex((p) => p.id === plugin.id);
    if (idx >= 0) {
      this.parsers[idx] = plugin;
    } else {
      this.parsers.push(plugin);
    }
    this.parsers.sort((a, b) => b.priority - a.priority);
  }

  registerAnalyzer(module: AnalyzerModule): void {
    const idx = this.analyzers.findIndex((m) => m.id === module.id);
    if (idx >= 0) {
      this.analyzers[idx] = module;
    } else {
      this.analyzers.push(module);
      if (module.defaultEnabled) {
        this.enabledAnalyzers.add(module.id);
      }
    }
  }

  setAnalyzerEnabled(id: string, enabled: boolean): void {
    if (enabled) {
      this.enabledAnalyzers.add(id);
    } else {
      this.enabledAnalyzers.delete(id);
    }
  }

  isAnalyzerEnabled(id: string): boolean {
    return this.enabledAnalyzers.has(id);
  }

  getParsers(): ExportParserPlugin[] {
    return [...this.parsers];
  }

  getAnalyzers(): AnalyzerModule[] {
    return [...this.analyzers];
  }

  findParser(file: ParserInputFile): ExportParserPlugin | undefined {
    return this.parsers.find((p) => p.canParse(file));
  }

  runAnalyzers(context: AnalyzerContext): AnalyzerInsight[] {
    const insights: AnalyzerInsight[] = [];
    for (const module of this.analyzers) {
      if (!this.enabledAnalyzers.has(module.id)) continue;
      try {
        insights.push(...module.analyze(context));
      } catch (err) {
        insights.push({
          id: `${module.id}-error`,
          moduleId: module.id,
          severity: 'warning',
          title: `Module "${module.name}" failed`,
          summary: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return insights;
  }

  listDescriptors(): WorkspaceModuleDescriptor[] {
    return [
      ...this.parsers.map((p) => ({
        id: p.id,
        name: p.name,
        kind: 'parser' as const,
        version: p.version,
        description: p.description,
        enabled: true,
      })),
      ...this.analyzers.map((a) => ({
        id: a.id,
        name: a.name,
        kind: 'analyzer' as const,
        version: a.version,
        description: a.description,
        enabled: this.enabledAnalyzers.has(a.id),
      })),
    ];
  }
}

export const defaultPluginRegistry = new PluginRegistry();
