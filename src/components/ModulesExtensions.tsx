import { useRef } from 'react';
import { Download, Layers, Puzzle, RotateCcw, ShieldCheck, Terminal, Upload } from 'lucide-react';
import type { WorkspaceModuleDescriptor } from '../core/plugins/registry';
import type { SmartProtectionConfig } from '../core/types';

interface ModulesExtensionsProps {
  modules: WorkspaceModuleDescriptor[];
  onToggleAnalyzer: (id: string, enabled: boolean) => void;
  protectionConfig: SmartProtectionConfig;
  onUpdateProtectionConfig: (patch: Partial<SmartProtectionConfig>) => void;
  onExportWorkspaceBackup: () => void;
  onImportWorkspaceBackup: (jsonText: string) => Promise<void>;
  onResetWorkspace: () => Promise<void>;
}

export function ModulesExtensions({
  modules,
  onToggleAnalyzer,
  protectionConfig,
  onUpdateProtectionConfig,
  onExportWorkspaceBackup,
  onImportWorkspaceBackup,
  onResetWorkspace,
}: ModulesExtensionsProps) {
  const backupInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="stack-md">
      {/* Extension & Companion Setup */}
      <div className="grid-2">
        <div className="card stack-sm">
          <div className="row-flex">
            <Puzzle size={18} style={{ color: 'var(--accent-2)' }} />
            <strong>Browser Extension Setup (Chrome / Edge / Brave)</strong>
          </div>
          <ol className="muted" style={{ margin: '4px 0', paddingLeft: 18, fontSize: '0.86rem' }}>
            <li>Download the pre-packaged MV3 extension ZIP below and extract it to a folder.</li>
            <li>Open <code className="mono">chrome://extensions</code> (or <code className="mono">edge://extensions</code>) and enable <strong>Developer Mode</strong>.</li>
            <li>Click <strong>Load unpacked</strong> and select the extracted folder.</li>
            <li>Ensure you are signed into <code className="mono">instagram.com</code> in the same browser profile, then refresh this page!</li>
          </ol>
          <div>
            <a
              href="./downloads/ig-auditor-extension.zip"
              download="ig-auditor-extension.zip"
              className="btn btn-cyan btn-sm"
            >
              <Download size={14} /> Download ig-auditor-extension.zip
            </a>
          </div>
        </div>

        <div className="card stack-sm">
          <div className="row-flex">
            <Terminal size={18} style={{ color: 'var(--accent)' }} />
            <strong>Local Playwright Companion Setup (Node.js CLI & Bridge)</strong>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: '0.84rem' }}>
            Clone the repository and start the authenticated local companion for headless or headed Chromium verification & CLI scheduling:
          </p>
          <pre className="pre-code" style={{ margin: 0 }}>{`git clone https://github.com/a-vip/ig-relationship-auditor.git
cd ig-relationship-auditor/companion
npm install
npx playwright install chromium
npm run login   # Sign into Instagram once in persistent profile
npm run serve   # Starts 127.0.0.1:47831 and prints Pairing Token`}</pre>
        </div>
      </div>

      {/* Smart Auto-Protection Rules */}
      <div className="card stack-sm">
        <div className="row-flex">
          <ShieldCheck size={18} style={{ color: 'var(--success)' }} />
          <strong>Smart Protection & Auto-Whitelist Rules</strong>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: '0.84rem' }}>
          Accounts matching any enabled rule are automatically shielded from the Unfollow Queue.
        </p>

        <div className="grid-3">
          <label className="card-subtle row-flex" style={{ cursor: 'pointer', fontSize: '0.86rem' }}>
            <input
              type="checkbox"
              checked={protectionConfig.protectCloseFriends}
              onChange={(e) =>
                onUpdateProtectionConfig({ protectCloseFriends: e.target.checked })
              }
            />
            Protect Close Friends list
          </label>

          <label className="card-subtle row-flex" style={{ cursor: 'pointer', fontSize: '0.86rem' }}>
            <input
              type="checkbox"
              checked={protectionConfig.protectFavorites}
              onChange={(e) => onUpdateProtectionConfig({ protectFavorites: e.target.checked })}
            />
            Protect Favorited accounts
          </label>

          <label className="card-subtle row-flex" style={{ cursor: 'pointer', fontSize: '0.86rem' }}>
            <input
              type="checkbox"
              checked={protectionConfig.protectVerified}
              onChange={(e) => onUpdateProtectionConfig({ protectVerified: e.target.checked })}
            />
            Protect Verified accounts (live-checked)
          </label>
        </div>

        <div className="grid-3">
          <div className="stack-sm">
            <label className="muted" style={{ fontSize: '0.8rem' }}>
              New Follow Grace Period (days)
            </label>
            <input
              type="number"
              className="input"
              min={0}
              max={365}
              value={protectionConfig.gracePeriodDays}
              onChange={(e) =>
                onUpdateProtectionConfig({ gracePeriodDays: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </div>

          <div className="stack-sm">
            <label className="muted" style={{ fontSize: '0.8rem' }}>
              Excluded Username Regex
            </label>
            <input
              type="text"
              className="input mono"
              placeholder="e.g. ^studio_|_official$"
              value={protectionConfig.excludedRegex}
              onChange={(e) => onUpdateProtectionConfig({ excludedRegex: e.target.value })}
            />
          </div>

          <div className="stack-sm">
            <label className="muted" style={{ fontSize: '0.8rem' }}>
              Protected Tags (comma-separated)
            </label>
            <input
              type="text"
              className="input"
              value={protectionConfig.protectedTags.join(', ')}
              onChange={(e) =>
                onUpdateProtectionConfig({
                  protectedTags: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </div>
        </div>
      </div>

      {/* Modular Plugin Registry */}
      <div className="card stack-sm">
        <div className="space-between">
          <div className="row-flex">
            <Layers size={18} style={{ color: 'var(--accent-2)' }} />
            <strong>Registered Parser Plugins & Analyzer Modules</strong>
          </div>
          <span className="pill pill-info">Extensible PluginRegistry</span>
        </div>

        <p className="muted" style={{ margin: 0, fontSize: '0.84rem' }}>
          All file parsers and insight analyzers register through <code className="mono">PluginRegistry</code>.
          See <code className="mono">docs/EXTENDING.md</code> in the repository to add Threads, TikTok, or
          custom scoring modules.
        </p>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Module</th>
                <th>Type</th>
                <th>Version</th>
                <th>Description</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m.id}>
                  <td><strong>{m.name}</strong></td>
                  <td><span className="pill pill-neutral">{m.kind}</span></td>
                  <td className="mono">{m.version}</td>
                  <td className="muted">{m.description}</td>
                  <td>
                    {m.kind === 'analyzer' ? (
                      <button
                        type="button"
                        className={`btn btn-sm ${m.enabled ? 'btn-cyan' : ''}`}
                        onClick={() => onToggleAnalyzer(m.id, !m.enabled)}
                      >
                        {m.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                    ) : (
                      <span className="pill pill-success">Active</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Backup & Storage */}
      <div className="card space-between">
        <div>
          <strong>Local Browser Storage & Workspace Backup</strong>
          <div className="muted" style={{ fontSize: '0.84rem' }}>
            Snapshots, whitelists, notes, and audit logs live strictly in your browser IndexedDB.
          </div>
        </div>
        <div className="row-flex">
          <button type="button" className="btn btn-sm" onClick={onExportWorkspaceBackup}>
            <Download size={14} /> Export Workspace JSON
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => backupInputRef.current?.click()}
          >
            <Upload size={14} /> Restore Backup
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={onResetWorkspace}
          >
            <RotateCcw size={14} /> Clear All Local Data
          </button>
          <input
            ref={backupInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                void file.text().then(onImportWorkspaceBackup);
              }
              e.target.value = '';
            }}
          />
        </div>
      </div>
    </div>
  );
}
