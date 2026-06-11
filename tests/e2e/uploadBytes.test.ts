import { describe, it, expect, inject } from 'vitest';
import SpeedTest from '../../src/index.ts';

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

const REQUESTED = 1e5;
const UPLOAD_COUNT = 2;

function runUpload(
  base: string,
  mode: 'half' | 'none',
  sessionId: string
): Promise<void> {
  const engine = new SpeedTest({
    autoStart: false,
    sessionId,
    downloadApiUrl: `${base}/__down`,
    uploadApiUrl: `${base}/__up?mode=${mode}`,
    logMeasurementApiUrl: `${base}/__log`,
    logAimApiUrl: `${base}/__results`,
    measureDownloadLoadedLatency: false,
    measureUploadLoadedLatency: false,
    measurements: [
      { type: 'latency', numPackets: 1 },
      { type: 'upload', bytes: REQUESTED, count: UPLOAD_COUNT }
    ]
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('speed test timed out')),
      60_000
    );
    engine.onError = error => {
      clearTimeout(timeout);
      reject(new Error(`speed test error: ${error}`));
    };
    engine.onFinish = () => {
      clearTimeout(timeout);
      resolve();
    };
    engine.play();
  });
}

// The /__log and /__results POSTs are fire-and-forget, so poll until the
// entries for this run's sessionId have arrived.
async function waitForCaptured(
  base: string,
  sessionId: string
): Promise<{ log: LogEntry[]; results: ResultsPayload[] }> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const res = await fetch(`${base}/__captured`);
    const data = (await res.json()) as Captured;
    const log = data.log.filter(
      l => l.sessionId === sessionId && l.type === 'up'
    );
    const results = data.results.filter(r => r.sessionId === sessionId);
    if (log.length >= UPLOAD_COUNT && results.length >= 1) {
      return { log, results };
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('captured __log/__results payloads did not arrive');
}

describe('upload bytes reporting (e2e)', () => {
  it('logs the server cf-meta-upload-bytes value, not the Content-Length', async () => {
    const base = inject('mockBaseUrl');
    const sessionId = `cap-${Date.now()}`;
    // Mock returns cf-meta-upload-bytes = floor(body / 2), i.e. fewer bytes
    // than were actually uploaded (Content-Length === REQUESTED).
    const accepted = Math.floor(REQUESTED / 2);

    await runUpload(base, 'half', sessionId);
    const { log, results } = await waitForCaptured(base, sessionId);

    // /__log per-measurement upload entries
    expect(log.length).toBe(UPLOAD_COUNT);
    for (const entry of log) {
      expect(entry.bytes).toBe(accepted);
      expect(entry.bytes).not.toBe(REQUESTED);
    }

    // /__results final payload upload points
    const uploadPoints = results[0].upload ?? [];
    expect(uploadPoints.length).toBeGreaterThan(0);
    for (const point of uploadPoints) {
      expect(point.bytes).toBe(accepted);
      expect(point.bytes).not.toBe(REQUESTED);
    }
  }, 90_000);

  it('falls back to the requested bytes when cf-meta-upload-bytes is absent', async () => {
    const base = inject('mockBaseUrl');
    const sessionId = `none-${Date.now()}`;

    await runUpload(base, 'none', sessionId);
    const { log, results } = await waitForCaptured(base, sessionId);

    expect(log.length).toBe(UPLOAD_COUNT);
    for (const entry of log) {
      expect(entry.bytes).toBe(REQUESTED);
    }

    const uploadPoints = results[0].upload ?? [];
    expect(uploadPoints.length).toBeGreaterThan(0);
    for (const point of uploadPoints) {
      expect(point.bytes).toBe(REQUESTED);
    }
  }, 90_000);
});
