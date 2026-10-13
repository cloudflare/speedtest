import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import BandwidthEngine, {
  hasUsableSpeed,
  type BandwidthEngineResults,
  type BandwidthMeasurement
} from '../../../src/engines/BandwidthEngine/BandwidthEngine';

/**
 * Browsers occasionally report `requestStart === responseStart` for a
 * transfer, leaving no duration to derive a speed from. Such samples must not
 * reach the results, where consumers expect `bps` to be a number.
 */

const UPLOAD_URL = 'https://speed.example.com/__up';

/** A resource timing entry whose TTFB, and so upload duration, is `ttfb`. */
const perfEntry = (ttfb: number) => ({
  startTime: 0,
  requestStart: 10,
  responseStart: 10 + ttfb,
  responseEnd: 10 + ttfb,
  transferSize: 0,
  connectStart: 0,
  connectEnd: 0,
  secureConnectionStart: 0,
  nextHopProtocol: 'h2'
});

/** Runs the engine with one resource timing entry per request, in order. */
const run = (measurements: BandwidthMeasurement[], ttfbs: number[]) => {
  const entries: ReturnType<typeof perfEntry>[] = [];
  const queue = [...ttfbs];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      entries.push(perfEntry(queue.shift() ?? 300));
      return new Response('');
    })
  );
  vi.stubGlobal('performance', {
    getEntriesByName: () => entries,
    clearResourceTimings: () => {}
  });

  const engine = new BandwidthEngine(measurements, {
    downloadApiUrl: 'https://speed.example.com/__down',
    uploadApiUrl: UPLOAD_URL
  });
  engine.getServerTime = null;
  engine.finishRequestDuration = 200;
  const onMeasurementResult = vi.fn();
  engine.onMeasurementResult = onMeasurementResult;

  return new Promise<{
    results: BandwidthEngineResults;
    onMeasurementResult: typeof onMeasurementResult;
  }>(resolve => {
    engine.onFinished = results =>
      // Results are emitted on the next tick.
      setTimeout(() => resolve({ results, onMeasurementResult }));
    engine.play();
  });
};

describe('hasUsableSpeed', () => {
  it('keeps transfers with a finite speed', () => {
    expect(hasUsableSpeed({ bps: 2.5e6 }, 1e5)).toBe(true);
  });

  it.each([undefined, NaN, Infinity])('rejects transfers with bps %s', bps => {
    expect(hasUsableSpeed({ bps }, 1e5)).toBe(false);
  });

  it('always keeps latency samples', () => {
    expect(hasUsableSpeed({ bps: undefined }, 0)).toBe(true);
  });
});

describe('BandwidthEngine unusable samples', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal('window', {
      location: { origin: 'https://speed.example.com' }
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('counts a zero-duration upload without storing or retrying it', async () => {
    const { results, onMeasurementResult } = await run(
      [{ dir: 'up', bytes: 1e5, count: 3 }],
      [300, 0, 300]
    );

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(results.up[1e5].numMeasurements).toBe(3);
    expect(results.up[1e5].timings.map(t => t.bps)).toEqual([
      expect.any(Number),
      expect.any(Number)
    ]);
    expect(onMeasurementResult).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      'Discarding up sample without a speed',
      expect.objectContaining({
        bytes: 1e5,
        ttfb: 0,
        bps: undefined,
        perf: expect.objectContaining({ requestStart: 10, responseStart: 10 })
      })
    );
  });

  it('keeps a discarded sample out of the finish duration', async () => {
    // Both kept samples exceed finishRequestDuration, so the direction must
    // finish before the next size; the discarded 0ms must not prevent it.
    const { results } = await run(
      [
        { dir: 'up', bytes: 1e5, count: 2 },
        { dir: 'up', bytes: 1e6, count: 1 }
      ],
      [300, 0]
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(results.up[1e6]).toBeUndefined();
  });
});
