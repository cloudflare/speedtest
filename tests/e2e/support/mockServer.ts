import { createServer } from 'node:http';

/**
 * Minimal mock of the speed.cloudflare.com transfer endpoints, used by the
 * upload-bytes e2e test. It lets the test force the server-accepted upload size
 * to differ from the request Content-Length, so we can prove the client logs
 * the `cf-meta-upload-bytes` header value rather than the body size.
 *
 * Upload behavior is selected via the `mode` query param on `/__up`:
 *  - `half` -> returns `cf-meta-upload-bytes: floor(receivedBytes / 2)`
 *             (server "accepts" fewer bytes than were sent)
 *  - `none` -> omits the header entirely (exercises the client fallback)
 *  - otherwise -> returns `cf-meta-upload-bytes: receivedBytes`
 *
 * POST bodies sent to `/__log` and `/__results` are captured and exposed via
 * `GET /__captured` so the browser test can read them back.
 */

interface LogEntry {
  sessionId?: string;
  type?: string;
  bytes?: number;
}

interface ResultsPayload {
  sessionId?: string;
  upload?: Array<{ bytes: number }>;
}

interface Captured {
  log: LogEntry[];
  results: ResultsPayload[];
}

export interface MockServer {
  url: string;
  close: () => Promise<void>;
}

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': 'cf-meta-upload-bytes, server-timing',
  'timing-allow-origin': '*'
};

const MAX_DOWNLOAD_BYTES = 5_000_000;

export async function startMockServer(): Promise<MockServer> {
  const captured: Captured = { log: [], results: [] };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    if (req.method === 'GET' && path === '/__down') {
      const requested = Number(url.searchParams.get('bytes') ?? '0');
      const size = Number.isFinite(requested)
        ? Math.max(0, Math.min(requested, MAX_DOWNLOAD_BYTES))
        : 0;
      res.writeHead(200, {
        ...CORS,
        'content-type': 'application/octet-stream'
      });
      res.end(Buffer.alloc(size, 0x30));
      return;
    }

    if (req.method === 'POST' && path === '/__up') {
      let received = 0;
      req.on('data', chunk => {
        received += chunk.length;
      });
      req.on('end', () => {
        const mode = url.searchParams.get('mode');
        const headers: Record<string, string> = { ...CORS };
        if (mode === 'half') {
          headers['cf-meta-upload-bytes'] = String(Math.floor(received / 2));
        } else if (mode !== 'none') {
          headers['cf-meta-upload-bytes'] = String(received);
        }
        res.writeHead(200, headers);
        res.end('___mock-token');
      });
      return;
    }

    if (req.method === 'POST' && (path === '/__log' || path === '/__results')) {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (path === '/__log') {
            captured.log.push(parsed as LogEntry);
          } else {
            captured.results.push(parsed as ResultsPayload);
          }
        } catch {
          // ignore malformed bodies
        }
        res.writeHead(200, CORS);
        res.end('ok');
      });
      return;
    }

    if (req.method === 'GET' && path === '/__captured') {
      res.writeHead(200, { ...CORS, 'content-type': 'application/json' });
      res.end(JSON.stringify(captured));
      return;
    }

    res.writeHead(404, CORS);
    res.end('not found');
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve()))
  };
}
