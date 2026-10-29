import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import BandwidthEngine, {
  getFinalResponseStart,
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

type PerfEntry = ReturnType<typeof perfEntry> & {
  firstInterimResponseStart?: number;
  finalResponseHeadersStart?: number;
};

/** A request whose entry is only recorded a task after its body resolves. */
type LateEntry = { late: number };

/**
 * A request with no entry of its own, while an entry for the same URL that
 * started earlier, from another request on the page, is recorded.
 */
type OtherRequestEntry = { otherRequest: number };

type Timing = number | PerfEntry | LateEntry | OtherRequestEntry | null;

/**
 * Runs the engine with one resource timing entry per request, in order, each
 * given as a TTFB, as a full entry, as a {@link LateEntry}, as an
 * {@link OtherRequestEntry}, or as `null` for a request with no entry.
 * Resolves when the engine finishes or fails.
 */
const run = (
  measurements: BandwidthMeasurement[],
  timings: Timing[],
  onConnectionError = vi.fn()
) => {
  const entries: (PerfEntry & { name: string })[] = [];
  const queue = [...timings];
  // Advances once per request, so each entry is stamped with its own request
  let clock = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const next = queue.length ? queue.shift()! : 300;
      const own = { name: url, startTime: clock };
      if (typeof next === 'number')
        entries.push({ ...perfEntry(next), ...own });
      else if (next && 'late' in next)
        setTimeout(() => entries.push({ ...perfEntry(next.late), ...own }));
      else if (next && 'otherRequest' in next)
        entries.push({
          ...perfEntry(next.otherRequest),
          ...own,
          startTime: own.startTime - 0.5
        });
      else if (next) entries.push({ ...next, ...own });
      return new Response('');
    })
  );
  vi.stubGlobal('performance', {
    now: () => ++clock,
    getEntriesByName: (name: string) =>
      entries.filter(entry => entry.name === name),
    clearResourceTimings: vi.fn()
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
    engine.onConnectionError = (...args) => {
      onConnectionError(...args);
      resolve({ results: engine.results, onMeasurementResult });
    };
    engine.play();
  });
};

describe('hasUsableSpeed', () => {
  it('keeps transfers with a finite speed', () => {
    expect(hasUsableSpeed({ bps: 2.5e6 }, 1e5)).toBe(true);
  });

  it.each([undefined, NaN, Infinity, 0, -2.5e6])(
    'rejects transfers with bps %s',
    bps => {
      expect(hasUsableSpeed({ bps }, 1e5)).toBe(false);
    }
  );

  it('always keeps latency samples', () => {
    expect(hasUsableSpeed({ bps: undefined }, 0)).toBe(true);
  });
});

describe('getFinalResponseStart', () => {
  const entry = (overrides: Partial<PerfEntry>) =>
    ({
      ...perfEntry(300),
      ...overrides
    }) as unknown as PerformanceResourceTiming;

  it('prefers the final headers over an interim response', () => {
    expect(
      getFinalResponseStart(
        entry({
          responseStart: 20,
          firstInterimResponseStart: 20,
          finalResponseHeadersStart: 310
        })
      )
    ).toBe(310);
  });

  it('falls back to responseStart where the field is unsupported', () => {
    expect(getFinalResponseStart(entry({}))).toBe(310);
  });

  it('falls back to responseStart when the field is zeroed', () => {
    expect(getFinalResponseStart(entry({ finalResponseHeadersStart: 0 }))).toBe(
      310
    );
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

  it('times an upload from the final response, not an interim one', async () => {
    const { results } = await run(
      [{ dir: 'up', bytes: 1e5, count: 1 }],
      [
        {
          ...perfEntry(300),
          responseStart: 20,
          firstInterimResponseStart: 20,
          finalResponseHeadersStart: 310
        }
      ]
    );

    const [timing] = results.up[1e5].timings;
    expect(timing.ttfb).toBe(300);
    expect(timing.bps).toBeCloseTo((8 * 1e5 * 1.005) / 0.3);
  });

  it('counts a request without a resource timing entry and moves on', async () => {
    const onConnectionError = vi.fn();
    const { results } = await run(
      [{ dir: 'down', bytes: 1e5, count: 3 }],
      [300, null, 300],
      onConnectionError
    );

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(onConnectionError).not.toHaveBeenCalled();
    expect(results.down[1e5].numMeasurements).toBe(3);
    expect(results.down[1e5].timings).toHaveLength(2);
    expect(warn).toHaveBeenCalledWith(
      'Discarding down sample without a resource timing entry',
      { url: expect.stringContaining('bytes=100000') }
    );
  });

  it("never uses an earlier request's entry for the same URL", async () => {
    const { results } = await run(
      [{ dir: 'down', bytes: 1e5, count: 2 }],
      [300, { otherRequest: 50 }]
    );

    expect(results.down[1e5].timings).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      'Discarding down sample without a resource timing entry',
      expect.anything()
    );
  });

  it('uses an entry recorded a task after the body', async () => {
    const { results } = await run(
      [{ dir: 'down', bytes: 1e5, count: 2 }],
      [300, { late: 300 }]
    );

    expect(results.down[1e5].timings).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('drops up to two missing entries in a row and carries on', async () => {
    const onConnectionError = vi.fn();
    const { results } = await run(
      [{ dir: 'down', bytes: 1e5, count: 5 }],
      [300, null, null, 300, null],
      onConnectionError
    );

    expect(onConnectionError).not.toHaveBeenCalled();
    expect(results.down[1e5].numMeasurements).toBe(5);
    expect(results.down[1e5].timings).toHaveLength(2);
  });

  it('fails after three missing entries in a row', async () => {
    const onConnectionError = vi.fn();
    await run(
      [{ dir: 'down', bytes: 1e5, count: 5 }],
      [null, null, null, 300, 300],
      onConnectionError
    );

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(onConnectionError).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('No resource timing entries for')
    );
  });

  it('stops when paused while waiting for a late entry', async () => {
    const entries: PerfEntry[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        setTimeout(() => entries.push(perfEntry(300)));
        return new Response('');
      })
    );
    const engine = new BandwidthEngine(
      [{ dir: 'down', bytes: 1e5, count: 2 }],
      {
        downloadApiUrl: 'https://speed.example.com/__down',
        uploadApiUrl: UPLOAD_URL
      }
    );
    vi.stubGlobal('performance', {
      now: () => 0,
      getEntriesByName: () => {
        // Paused just before the engine waits for the entry
        if (!entries.length) engine.pause();
        return [...entries];
      },
      clearResourceTimings: vi.fn()
    });
    engine.getServerTime = null;
    const onMeasurementResult = vi.fn();
    engine.onMeasurementResult = onMeasurementResult;

    engine.play();
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(fetch).toHaveBeenCalledOnce();
    expect(onMeasurementResult).not.toHaveBeenCalled();
  });

  it('resumes when paused and played again mid-request', async () => {
    const entries: (PerfEntry & { name: string })[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (vi.mocked(fetch).mock.calls.length === 1)
          return new Promise<Response>((_, reject) =>
            init.signal!.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            )
          );
        entries.push({ ...perfEntry(300), name: url });
        return new Response('');
      })
    );
    vi.stubGlobal('performance', {
      now: () => 0,
      getEntriesByName: (name: string) =>
        entries.filter(entry => entry.name === name),
      clearResourceTimings: vi.fn()
    });
    const engine = new BandwidthEngine(
      [{ dir: 'down', bytes: 1e5, count: 1 }],
      {
        downloadApiUrl: 'https://speed.example.com/__down',
        uploadApiUrl: UPLOAD_URL
      }
    );
    engine.getServerTime = null;
    const onConnectionError = vi.fn();
    engine.onConnectionError = onConnectionError;
    const finished = new Promise(resolve => {
      engine.onFinished = resolve;
    });

    engine.play();
    engine.pause();
    engine.play();
    await finished;

    expect(onConnectionError).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the resource timing buffer between sets', async () => {
    // Clearing it drops entries of requests still in flight elsewhere on the page
    await run(
      [
        { dir: 'down', bytes: 1e5, count: 1, bypassMinDuration: true },
        { dir: 'down', bytes: 1e6, count: 1 }
      ],
      [300, 300]
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(performance.clearResourceTimings).not.toHaveBeenCalled();
  });

  it('discards an upload with a negative duration', async () => {
    const { results } = await run(
      [{ dir: 'up', bytes: 1e5, count: 2 }],
      [300, -5]
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(results.up[1e5].timings).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      'Discarding up sample without a speed',
      expect.objectContaining({ ttfb: -5 })
    );
  });
});
