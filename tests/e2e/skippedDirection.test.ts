import { afterEach, expect, it, vi } from 'vitest';
import SpeedTest from '../../src';

const originalFetch = window.fetch;

afterEach(() => {
  window.fetch = originalFetch;
  vi.restoreAllMocks();
});

it('pauses the step that follows a skipped direction', async () => {
  // Slower than bandwidthFinishRequestDuration, so the direction finishes
  vi.spyOn(performance, 'getEntriesByName').mockReturnValue([
    {
      connectEnd: 0,
      connectStart: 0,
      nextHopProtocol: 'h2',
      requestStart: 0,
      responseEnd: 1_500,
      responseStart: 10,
      secureConnectionStart: 0,
      startTime: Number.MAX_SAFE_INTEGER,
      transferSize: 1_000
    } as PerformanceResourceTiming
  ]);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);

  let latencySignal: AbortSignal | undefined;
  const latencyStarted = new Promise<void>(resolve => {
    window.fetch = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = new URL(input.toString());
        if (url.searchParams.get('bytes') !== '0') {
          return Promise.resolve(new Response('ok'));
        }
        latencySignal = init?.signal ?? undefined;
        resolve();
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason)
          );
        });
      }
    );
  });

  const engine = new SpeedTest({
    autoStart: false,
    downloadApiUrl: 'https://example.com/down',
    uploadApiUrl: 'https://example.com/up',
    logAimApiUrl: null,
    logMeasurementApiUrl: null,
    measureDownloadLoadedLatency: false,
    measurements: [
      { type: 'download', bytes: 1_000, count: 1 },
      { type: 'download', bytes: 10_000, count: 1 },
      { type: 'latency', numPackets: 1 }
    ]
  });

  engine.play();
  await latencyStarted;
  engine.pause();

  expect(latencySignal?.aborted).toBe(true);
  const requested = vi
    .mocked(window.fetch)
    .mock.calls.map(([input]) => input.toString());
  expect(requested).not.toContainEqual(expect.stringContaining('bytes=10000'));
});
