import { useRef, useState } from 'react';
import { FileArchive, FolderOpen, Sparkles, Upload, FileText } from 'lucide-react';
import {
  collectDroppedEntries,
  ingestRawFiles,
  ingestUploadedFiles,
} from '../core/parsers/ingestEngine';
import type { ExportSnapshot } from '../core/types';

interface DropzoneIngestProps {
  onSnapshotImported: (snapshot: ExportSnapshot) => void;
  onLoadDemo: () => Promise<void>;
  compact?: boolean;
}

export function DropzoneIngest({
  onSnapshotImported,
  onLoadDemo,
  compact = false,
}: DropzoneIngestProps) {
  const [dragging, setDragging] = useState(false);
  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteTarget, setPasteTarget] = useState<'following' | 'followers'>('following');
  const [pasteText, setPasteText] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  async function processFiles(files: File[] | FileList) {
    if (!files || files.length === 0) return;
    setErrorMsg(null);
    setBusyMsg('Scanning uploaded Instagram data...');
    try {
      const snapshot = await ingestUploadedFiles(files, {
        onProgress: (msg) => setBusyMsg(msg),
      });
      onSnapshotImported(snapshot);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyMsg(null);
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    setErrorMsg(null);
    setBusyMsg('Collecting dropped files & directories...');
    try {
      const files = await collectDroppedEntries(e.dataTransfer);
      await processFiles(files);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setBusyMsg(null);
    }
  }

  async function handlePasteImport() {
    if (!pasteText.trim()) return;
    setErrorMsg(null);
    setBusyMsg('Parsing pasted data...');
    try {
      const trimmed = pasteText.trim();
      const isJson = trimmed.startsWith('{') || trimmed.startsWith('[');
      const isHtml = trimmed.toLowerCase().includes('<html') || trimmed.includes('instagram.com/');
      const ext = isJson ? 'json' : isHtml && trimmed.includes('<') ? 'html' : 'txt';
      const filename = `${pasteTarget}.${ext}`;
      const snapshot = await ingestRawFiles(
        [
          {
            name: filename,
            path: filename,
            content: trimmed,
            lastModified: Date.now(),
          },
        ],
        { label: `Pasted ${pasteTarget} (${ext.toUpperCase()})` },
      );
      onSnapshotImported(snapshot);
      setPasteText('');
      setShowPaste(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyMsg(null);
    }
  }

  return (
    <div className="stack-md">
      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <div className="stack-sm" style={{ alignItems: 'center' }}>
          <Upload size={compact ? 26 : 36} style={{ color: 'var(--accent-2)' }} />
          <h2 style={{ margin: 0, fontSize: compact ? '1.05rem' : '1.35rem' }}>
            Drop Your Instagram Data Download (ZIP, Folder, HTML, JSON, or CSV)
          </h2>
          <p className="muted" style={{ margin: '2px 0 10px', maxWidth: 680, fontSize: '0.9rem' }}>
            100% client-side processing — your files never leave your browser. Automatically skips heavy
            media folders and parses <code className="mono">followers_*.html/.json</code>,{' '}
            <code className="mono">following.html/.json</code>, pending requests, close friends, and
            recently unfollowed records.
          </p>

          <div className="row-flex" style={{ justifyContent: 'center' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={Boolean(busyMsg)}
            >
              <FileArchive size={16} /> Select ZIP / HTML / JSON Files
            </button>

            <button
              type="button"
              className="btn btn-cyan"
              onClick={() => folderInputRef.current?.click()}
              disabled={Boolean(busyMsg)}
            >
              <FolderOpen size={16} /> Select Export Folder
            </button>

            <button
              type="button"
              className="btn"
              onClick={() => setShowPaste((v) => !v)}
              disabled={Boolean(busyMsg)}
            >
              <FileText size={16} /> Paste Raw Data
            </button>

            <button
              type="button"
              className="btn"
              onClick={() => {
                setBusyMsg('Generating realistic HTML+JSON demo dataset...');
                onLoadDemo().finally(() => setBusyMsg(null));
              }}
              disabled={Boolean(busyMsg)}
            >
              <Sparkles size={16} /> Load Sample Demo
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".zip,.html,.htm,.json,.csv,.tsv,.txt"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) void processFiles(e.target.files);
              e.target.value = '';
            }}
          />

          <input
            ref={folderInputRef}
            type="file"
            multiple
            // @ts-expect-error webkitdirectory is supported in Chromium/Firefox/Safari folder selection
            webkitdirectory=""
            directory=""
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) void processFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {busyMsg && (
        <div className="banner banner-info">
          <span>{busyMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="banner banner-danger">
          <span>{errorMsg}</span>
        </div>
      )}

      {showPaste && (
        <div className="card stack-sm">
          <div className="space-between">
            <strong>Paste HTML, JSON, CSV, or Username List</strong>
            <div className="row-flex">
              <label className="muted" style={{ fontSize: '0.82rem' }}>
                Classify as:
              </label>
              <select
                className="select"
                value={pasteTarget}
                onChange={(e) => setPasteTarget(e.target.value as 'following' | 'followers')}
              >
                <option value="following">Following</option>
                <option value="followers">Followers</option>
              </select>
            </div>
          </div>
          <textarea
            className="textarea mono"
            rows={5}
            placeholder="Paste contents of following.html / followers_1.json / newline usernames..."
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <div className="row-flex">
            <button type="button" className="btn btn-primary" onClick={handlePasteImport}>
              Parse & Import
            </button>
            <button type="button" className="btn" onClick={() => setShowPaste(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
