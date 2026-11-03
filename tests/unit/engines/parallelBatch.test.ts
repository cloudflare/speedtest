import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import LoggingBandwidthEngine from '../../../src/engines/BandwidthEngine/LoggingBandwidthEngine';
import BandwidthEngine, {
  aggregateBatchTiming,
  getParallelism,
  getSampleBytes,
  type BandwidthEngineOptions,
  type BandwidthEngineResults,
  type BandwidthMeasurement,
  type BatchRequestTiming
} from '../../../src/engines/BandwidthEngine/BandwidthEngine';

const perf = (
  requestStart: number,
  responseStart: number,
  responseEnd: number,
  transferSize = 0
): BatchRequestTiming['perf'] => ({
  requestStart,
  responseStart,
  responseEnd,
  transferSize
});

describe('getParallelism', () => {
  it.each([
    [undefined, 1],
    [1, 1],
    [4, 4],
    [2.7, 2],
    [0, 1],
    [-3, 1],
    [NaN, 1],
    [Infinity, 1],
    [-Infinity, 1]
  ])('maps %s to %s', (parallel, expected) => {
    expect(getParallelism({ parallel })).toBe(expected);
  });
});

describe('getSampleBytes', () => {
  it('counts the payload of every request in the batch', () => {
    expect(getSampleBytes({ bytes: 2e7, parallel: 4 })).toBe(8e7);
    expect(getSampleBytes({ bytes: 2e7 })).toBe(2e7);
  });
});

describe('aggregateBatchTiming', () => {
  it('times a download batch from the first start to the last completion', () => {
    const timing = aggregateBatchTiming(
      [
        { perf: perf(10, 30, 210, 1000), serverTime: 5 },
        { perf: perf(12, 40, 260, 1000), serverTime: 8 }
      ],
      { isDown: true, numBytes: 1000 }
    );

    // 260 - 10, minus the smallest server time
    expect(timing.duration).toBe(245);
    expect(timing.ttfb).toBe(20);
    expect(timing.ping).toBe(15);
    expect(timing.payloadDownloadTime).toBe(230);
    expect(timing.serverTime).toBe(5);
    expect(timing.transferSize).toBe(2000);
    expect(timing.bps).toBeCloseTo((8 * 2000) / 0.245);
  });

  it('estimates the size of the whole batch when any size is missing', () => {
    const timing = aggregateBatchTiming(
      [{ perf: perf(0, 10, 110, 1000) }, { perf: perf(0, 10, 110, 0) }],
      { isDown: true, numBytes: 1000 }
    );

    expect(timing.transferSize).toBe(0);
    expect(timing.serverTime).toBe(-1);
    expect(timing.bps).toBeCloseTo((8 * 2000 * 1.005) / 0.11);
  });

  it('ends an upload batch at the last final response', () => {
    const timing = aggregateBatchTiming(
      [{ perf: perf(0, 100, 105) }, { perf: perf(5, 150, 152) }],
      { isDown: false, numBytes: 1000 }
    );

    expect(timing.duration).toBe(150);
    expect(timing.payloadDownloadTime).toBe(2);
    expect(timing.bps).toBeCloseTo((8 * 2000 * 1.005) / 0.15);
  });

  it('prefers the final response headers over an interim response', () => {
    const timing = aggregateBatchTiming(
      [
        {
          perf: { ...perf(0, 5, 300), finalResponseHeadersStart: 100 }
        },
        { perf: perf(0, 200, 250) }
      ],
      { isDown: false, numBytes: 1000 }
    );

    expect(timing.duration).toBe(200);
    expect(timing.ttfb).toBe(100);
  });
});

describe('BandwidthEngine parallel batches', () => {
  let inFlight: number;
  let maxInFlight: number;
  let entries: (BatchRequestTiming['perf'] & {
    name: string;
    startTime: number;
  })[];
  let clock: number;
  let failUrl: RegExp | undefined;
  let failResponse: () => Response;
  // Requests whose resource timing entry is never recorded
  let skipEntryUrl: RegExp | undefined;
  // Requests after this many calls never settle unless aborted
  let hangAfterCalls: number;
  let responseDelay: number;
  let bodyFor: (url: string) => string;
  // Requests whose entries lack detailed timings, as without Timing-Allow-Origin
  let restrictedUrl: RegExp | undefined;

  beforeEach(() => {
    inFlight = 0;
    maxInFlight = 0;
    entries = [];
    clock = 0;
    failUrl = undefined;
    failResponse = () => new Response(null, { status: 500 });
    skipEntryUrl = undefined;
    hangAfterCalls = Infinity;
    responseDelay = 0;
    bodyFor = () => '';
    restrictedUrl = undefined;
    vi.stubGlobal('window', {
      location: { origin: 'https://speed.example.com' }
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const startTime = clock;
        if (vi.mocked(fetch).mock.calls.length > hangAfterCalls) {
          return new Promise<Response>((_, reject) =>
            init?.signal?.addEventListener('abort', () =>
              reject(init.signal!.reason)
            )
          );
        }
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(resolve => setTimeout(resolve, responseDelay));
        inFlight -= 1;
        if (failUrl?.test(url)) {
          failUrl = undefined;
          return failResponse();
        }
        if (skipEntryUrl?.test(url)) {
          skipEntryUrl = undefined;
          return new Response('');
        }
        entries.push({
          name: url,
          startTime,
          ...(restrictedUrl?.test(url)
            ? perf(0, 0, 5000, 0)
            : perf(10, 20, 220, 1e5)),
          connectStart: 0,
          connectEnd: 0,
          secureConnectionStart: 0,
          nextHopProtocol: 'h2'
        } as (typeof entries)[number]);
        return new Response(bodyFor(url), {
          headers: { 'cf-meta-request-time': '1700000000000' }
        });
      })
    );
    vi.stubGlobal('performance', {
      now: () => ++clock,
      getEntriesByName: (name: string) =>
        entries.filter(entry => entry.name === name),
      clearResourceTimings: vi.fn()
    });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const run = (
    measurements: BandwidthMeasurement[],
    options: BandwidthEngineOptions = {},
    setup: (engine: BandwidthEngine) => void = () => {}
  ) => {
    const engine = new BandwidthEngine(measurements, {
      downloadApiUrl: 'https://a.example.com/__down',
      uploadApiUrl: 'https://a.example.com/__up',
      ...options
    });
    engine.getServerTime = null;
    const onConnectionError = vi.fn();
    const onNewMeasurementStarted = vi.fn();
    engine.onConnectionError = onConnectionError;
    engine.onNewMeasurementStarted = onNewMeasurementStarted;
    return new Promise<{
      results: BandwidthEngineResults;
      onConnectionError: typeof onConnectionError;
      onNewMeasurementStarted: typeof onNewMeasurementStarted;
    }>(resolve => {
      engine.onFinished = results =>
        setTimeout(() =>
          resolve({ results, onConnectionError, onNewMeasurementStarted })
        );
      engine.play();
      setup(engine);
    });
  };

  const requestedUrls = () =>
    vi.mocked(fetch).mock.calls.map(([url]) => new URL(url as string));

  it('runs count batches of parallel requests, one sample each', async () => {
    const { results, onNewMeasurementStarted } = await run([
      { dir: 'down', bytes: 1e5, count: 2, parallel: 3 }
    ]);

    expect(fetch).toHaveBeenCalledTimes(6);
    expect(maxInFlight).toBe(3);
    expect(results.down[3e5].numMeasurements).toBe(2);
    expect(results.down[3e5].timings).toHaveLength(2);
    expect(results.down[3e5].timings[0].transferSize).toBe(3e5);
    expect(onNewMeasurementStarted).toHaveBeenCalledWith(
      expect.objectContaining({ bytes: 3e5, count: 2 }),
      expect.anything()
    );
    expect(requestedUrls().map(url => url.searchParams.get('bytes'))).toEqual(
      Array(6).fill('100000')
    );
    expect(requestedUrls().map(url => url.searchParams.get('req'))).toEqual([
      '0',
      '1',
      '2',
      '0',
      '1',
      '2'
    ]);
  });

  it('keeps sequential requests one at a time without a batch marker', async () => {
    const { results } = await run([{ dir: 'up', bytes: 1e5, count: 3 }]);

    expect(maxInFlight).toBe(1);
    expect(results.up[1e5].timings).toHaveLength(3);
    expect(console.warn).not.toHaveBeenCalled();
    expect(requestedUrls().every(url => !url.searchParams.has('req'))).toBe(
      true
    );
  });

  it('round-robins batch requests across hosts', async () => {
    await run([{ dir: 'down', bytes: 1e5, count: 2, parallel: 3 }], {
      downloadApiUrl: [
        'https://a.example.com/__down',
        'https://b.example.com/__down'
      ]
    });

    expect(requestedUrls().map(url => url.hostname)).toEqual([
      'a.example.com',
      'b.example.com',
      'a.example.com',
      'b.example.com',
      'a.example.com',
      'b.example.com'
    ]);
  });

  it('round-robins sequential requests across hosts, from a random start', async () => {
    vi.mocked(Math.random).mockReturnValue(0.6);
    await run([{ dir: 'up', bytes: 1e5, count: 3 }], {
      uploadApiUrl: ['https://a.example.com/__up', 'https://b.example.com/__up']
    });

    expect(requestedUrls().map(url => url.hostname)).toEqual([
      'b.example.com',
      'a.example.com',
      'b.example.com'
    ]);
  });

  it('discards a batch with a failed request and carries on', async () => {
    failUrl = /req=1/;
    const { results, onConnectionError } = await run([
      { dir: 'down', bytes: 1e5, count: 2, parallel: 2 }
    ]);

    expect(onConnectionError).toHaveBeenCalledTimes(1);
    expect(onConnectionError.mock.calls[0][0]).toMatch(
      /^Request failed with 500/
    );
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(results.down[2e5].timings).toHaveLength(1);
  });

  it('retries the whole batch after a 429', async () => {
    failUrl = /req=1/;
    failResponse = () =>
      new Response(null, { status: 429, headers: { 'retry-after': '0' } });
    const { results, onConnectionError } = await run([
      { dir: 'down', bytes: 1e5, count: 1, parallel: 2 }
    ]);

    expect(onConnectionError).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(results.down[2e5].timings).toHaveLength(1);
  });

  it('warns about each batch request with an unexpected size', async () => {
    await run([{ dir: 'down', bytes: 5e4, count: 1, parallel: 2 }]);

    expect(
      vi
        .mocked(console.warn)
        .mock.calls.filter(([msg]) =>
          String(msg).startsWith('Requested 50000B')
        )
    ).toHaveLength(2);
  });

  it('keeps the abort timer across a 429 retry of the batch', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      failUrl = /req=1/;
      failResponse = () =>
        new Response(null, { status: 429, headers: { 'retry-after': '0' } });
      const onConnectionError = vi.fn();
      const engine = new BandwidthEngine(
        [{ dir: 'down', bytes: 1e5, count: 1, parallel: 2 }],
        {
          downloadApiUrl: 'https://a.example.com/__down',
          uploadApiUrl: 'https://a.example.com/__up'
        }
      );
      engine.getServerTime = null;
      engine.abortRequestDuration = 50;
      engine.onConnectionError = onConnectionError;
      // The 429 arrives at 30ms and the retried batch never settles, so only
      // the original 50ms abort timer can end it before 55ms
      responseDelay = 30;
      hangAfterCalls = 2;
      engine.play();
      await vi.advanceTimersByTimeAsync(55);

      expect(fetch).toHaveBeenCalledTimes(4);
      expect(onConnectionError).toHaveBeenCalledTimes(1);
      expect(onConnectionError.mock.calls[0][0]).toMatch(
        /exceeded abortRequestDuration \(50ms\)/
      );
      engine.pause();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reruns a batch interrupted by pause()', async () => {
    const { results } = await run(
      [{ dir: 'down', bytes: 1e5, count: 1, parallel: 2 }],
      {},
      engine => {
        engine.pause();
        engine.play();
      }
    );

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(results.down[2e5].timings).toHaveLength(1);
  });

  it('discards a batch with a request missing its resource timing entry', async () => {
    skipEntryUrl = /req=1/;
    const { results } = await run([
      { dir: 'down', bytes: 1e5, count: 2, parallel: 2 }
    ]);

    expect(console.warn).toHaveBeenCalledWith(
      'Discarding down sample without a resource timing entry',
      { url: expect.stringMatching(/req=1/) }
    );
    expect(results.down[2e5].timings).toHaveLength(1);
  });

  it.each(['down', 'up'] as const)(
    'discards a sequential %s sample without detailed timings',
    async dir => {
      restrictedUrl = /b\.example\.com/;
      const { results } = await run([{ dir, bytes: 1e5, count: 2 }], {
        downloadApiUrl: [
          'https://a.example.com/__down',
          'https://b.example.com/__down'
        ],
        uploadApiUrl: [
          'https://a.example.com/__up',
          'https://b.example.com/__up'
        ]
      });

      expect(console.warn).toHaveBeenCalledWith(
        `Discarding ${dir} sample without detailed resource timing`,
        { url: expect.stringContaining('b.example.com') }
      );
      expect(results[dir][1e5].timings).toHaveLength(1);
    }
  );

  it('discards a batch with a request without detailed timings', async () => {
    restrictedUrl = /b\.example\.com/;
    const { results } = await run(
      [{ dir: 'down', bytes: 1e5, count: 2, parallel: 2 }],
      {
        downloadApiUrl: [
          'https://a.example.com/__down',
          'https://b.example.com/__down'
        ]
      }
    );

    expect(console.warn).toHaveBeenCalledWith(
      'Discarding down sample without detailed resource timing',
      { url: expect.stringContaining('b.example.com') }
    );
    expect(results.down[2e5]?.timings ?? []).toHaveLength(0);
  });

  it('ends the set after repeated samples without detailed timings', async () => {
    restrictedUrl = /./;
    const onFatalError = vi.fn();
    const engine = new BandwidthEngine(
      [{ dir: 'down', bytes: 1e5, count: 5, parallel: 2 }],
      {
        downloadApiUrl: 'https://a.example.com/__down',
        uploadApiUrl: 'https://a.example.com/__up'
      }
    );
    engine.getServerTime = null;
    await new Promise<void>(resolve => {
      engine.onFatalError = error => {
        onFatalError(error);
        resolve();
      };
      engine.play();
    });

    expect(fetch).toHaveBeenCalledTimes(6);
    expect(onFatalError.mock.calls[0][0]).toMatch(/Timing-Allow-Origin/);
  });

  it('reports each batch request with its own timing and response tail', async () => {
    bodyFor = url =>
      `${'0'.repeat(5000)}___token-${new URL(url).searchParams.get('req')}`;
    const onRequestResult = vi.fn();
    await run(
      [{ dir: 'down', bytes: 1e5, count: 1, parallel: 3 }],
      {},
      engine => {
        engine.onRequestResult = onRequestResult;
      }
    );

    expect(onRequestResult).toHaveBeenCalledTimes(3);
    onRequestResult.mock.calls.forEach(([result, response], i) => {
      expect(result).toMatchObject({ type: 'down', bytes: 1e5 });
      expect(result.duration).toBe(210);
      expect(response.url).toContain(`req=${i}`);
      expect(response.body.length).toBeLessThanOrEqual(1024);
      expect(response.body.endsWith(`___token-${i}`)).toBe(true);
    });
  });
});

describe('LoggingBandwidthEngine with parallel batches', () => {
  const LOG_URL = 'https://log.example.com/__log';

  beforeEach(() => {
    const entries: { name: string; startTime: number }[] = [];
    let clock = 0;
    vi.stubGlobal('window', {
      location: { origin: 'https://speed.example.com' }
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === LOG_URL) return new Response('ok');
        const req = new URL(url).searchParams.get('req');
        entries.push({
          name: url,
          startTime: clock,
          requestStart: 10,
          responseStart: 20,
          responseEnd: 220,
          transferSize: 1e5,
          connectStart: 0,
          connectEnd: 0,
          secureConnectionStart: 0,
          nextHopProtocol: 'h2'
        } as { name: string; startTime: number });
        return new Response(`${'0'.repeat(100)}___token-${req}`, {
          headers: { 'cf-meta-request-time': `${1700000000000 + Number(req)}` }
        });
      })
    );
    vi.stubGlobal('performance', {
      now: () => ++clock,
      getEntriesByName: (name: string) =>
        entries.filter(entry => entry.name === name),
      clearResourceTimings: vi.fn()
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('logs each request with its own size, token and request time', async () => {
    const engine = new LoggingBandwidthEngine(
      [{ dir: 'down', bytes: 1e5, count: 1, parallel: 2 }],
      {
        downloadApiUrl: 'https://a.example.com/__down',
        uploadApiUrl: 'https://a.example.com/__up',
        logApiUrl: LOG_URL,
        measurementId: 'meas-1'
      }
    );
    engine.getServerTime = null;
    await new Promise(resolve => {
      engine.onFinished = resolve;
      engine.play();
    });

    const logged = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => url === LOG_URL)
      .map(([, init]) => JSON.parse(init!.body as string));
    expect(logged).toHaveLength(2);
    expect(logged).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bytes: 1e5,
          token: 'token-0',
          requestTime: 1700000000000,
          measId: 'meas-1'
        }),
        expect.objectContaining({
          bytes: 1e5,
          token: 'token-1',
          requestTime: 1700000000001,
          measId: 'meas-1'
        })
      ])
    );
  });
});
