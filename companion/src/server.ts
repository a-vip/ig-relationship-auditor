import http from 'node:http';
import { InstagramPlaywrightClient } from './ig-playwright.js';
import {
  isOriginAllowed,
  verifyToken,
  type CompanionConfig,
} from './protocol.js';

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function startCompanionServer(config: CompanionConfig): {
  server: http.Server;
  client: InstagramPlaywrightClient;
} {
  const client = new InstagramPlaywrightClient(config.profileDir, config.headless);

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (!isOriginAllowed(origin, config.allowedOrigins)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Origin not allowed');
      return;
    }

    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Auditor-Token');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const tokenHeader = req.headers['x-auditor-token'];
    const providedToken = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
    if (!verifyToken(config.token, providedToken)) {
      sendJson(res, 401, { error: 'Invalid or missing X-Auditor-Token pairing token.' });
      return;
    }

    try {
      const urlPath = (req.url || '/').split('?')[0];

      if (req.method === 'GET' && urlPath === '/api/status') {
        const status = await client.getSessionStatus();
        sendJson(res, 200, {
          connected: true,
          version: '1.0.0',
          ...status,
        });
        return;
      }

      if (req.method === 'POST' && urlPath === '/api/login') {
        const result = await client.openInteractiveLogin();
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && urlPath === '/api/sync-graph') {
        const body = await readJsonBody(req);
        const graph = await client.syncLiveGraph({
          delayMs: typeof body.delayMs === 'number' ? body.delayMs : undefined,
          maxPages: typeof body.maxPages === 'number' ? body.maxPages : undefined,
        });
        sendJson(res, 200, graph);
        return;
      }

      if (req.method === 'POST' && urlPath === '/api/fact-check') {
        const body = await readJsonBody(req);
        const targets = Array.isArray(body.targets)
          ? (body.targets as Array<{ username: string; userId?: string }>)
          : [];
        const probes = await client.factCheckAccounts(targets, {
          delayMs: typeof body.delayMs === 'number' ? body.delayMs : undefined,
          useDomFallback: typeof body.useDomFallback === 'boolean' ? body.useDomFallback : true,
        });
        sendJson(res, 200, probes);
        return;
      }

      if (req.method === 'POST' && urlPath === '/api/unfollow') {
        const body = await readJsonBody(req);
        const target = (body.target ?? {}) as { username: string; userId?: string };
        const result = await client.unfollowAccount(target, {
          verifyBeforeUnfollow: body.verifyBeforeUnfollow !== false,
          useDomFallback: body.useDomFallback !== false,
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && urlPath === '/api/abort') {
        client.requestAbort();
        sendJson(res, 200, { aborted: true });
        return;
      }

      sendJson(res, 404, { error: `Unknown route: ${urlPath}` });
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  server.listen(config.port, config.host);
  return { server, client };
}
