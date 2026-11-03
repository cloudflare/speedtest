import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    [NaN, 1]
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

  beforeEach(() => {
    inFlight = 0;
    maxInFlight = 0;
    entries = [];
    clock = 0;
    failUrl = undefined;
    failResponse = () => new Response(null, { status: 500 });
    vi.stubGlobal('window', {
      location: { origin: 'https://speed.example.com' }
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const startTime = clock;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(resolve => setTimeout(resolve));
        inFlight -= 1;
        if (failUrl?.test(url)) {
          failUrl = undefined;
          return failResponse();
        }
        entries.push({
          name: url,
          startTime,
          ...perf(10, 20, 220, 1e5),
          connectStart: 0,
          connectEnd: 0,
          secureConnectionStart: 0,
          nextHopProtocol: 'h2'
        } as (typeof entries)[number]);
        return new Response('');
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
    options: BandwidthEngineOptions = {}
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
});
