#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { defaultProfileDir, InstagramPlaywrightClient } from './ig-playwright.js';
import { generatePairingToken, normalizeHandle } from './protocol.js';
import { startCompanionServer } from './server.js';

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main(): Promise<void> {
  const command = process.argv[2] || 'serve';
  const profileDir = getArg('--profile-dir') || defaultProfileDir();
  const headless = !hasFlag('--headed');

  if (command === 'login') {
    const client = new InstagramPlaywrightClient(profileDir, false);
    console.log('Opening Chromium with persistent profile at:', profileDir);
    const res = await client.openInteractiveLogin();
    console.log(res.message);
    console.log('Press Ctrl+C after finishing login in the browser window.');
    return;
  }

  if (command === 'fact-check') {
    const targetsPath = getArg('--targets');
    const outPath = getArg('--out') || 'fact-check-report.json';
    if (!targetsPath || !fs.existsSync(targetsPath)) {
      console.error('Provide --targets <file-with-usernames.txt|json>');
      process.exit(1);
    }
    const raw = fs.readFileSync(targetsPath, 'utf8');
    const usernames = raw.trim().startsWith('[')
      ? (JSON.parse(raw) as string[]).map(normalizeHandle)
      : raw
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .map(normalizeHandle);

    const client = new InstagramPlaywrightClient(profileDir, headless);
    const probes = await client.factCheckAccounts(
      usernames.map((u) => ({ username: u })),
    );
    fs.writeFileSync(path.resolve(outPath), JSON.stringify({ kind: 'ig_auditor_probes', probes }, null, 2));
    console.log(`Saved ${probes.length} fact-check probes to ${outPath}`);
    await client.close();
    return;
  }

  if (command === 'serve') {
    const port = Number(getArg('--port') || 47831);
    const host = '127.0.0.1';
    const token = getArg('--token') || process.env.AUDITOR_TOKEN || generatePairingToken();
    const extraOrigin = getArg('--origin');

    const { server, client } = startCompanionServer({
      port,
      host,
      token,
      profileDir,
      headless,
      allowedOrigins: extraOrigin ? [extraOrigin] : [],
    });

    console.log('');
    console.log('=== IG Relationship Auditor Local Companion ===');
    console.log(`Listening on:   http://${host}:${port}`);
    console.log(`Pairing Token:  ${token}`);
    console.log(`Profile Dir:    ${profileDir}`);
    console.log('Paste the Pairing Token into the Fact-Check tab on GitHub Pages.');
    console.log('');

    process.on('SIGINT', async () => {
      await client.close();
      server.close();
      process.exit(0);
    });
    return;
  }

  console.log('Usage: ig-auditor <serve|login|fact-check> [--port 47831] [--headed] [--token <token>]');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
