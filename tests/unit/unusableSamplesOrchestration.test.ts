import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SpeedTest from '../../src';

/**
 * The orchestrator runs one bandwidth engine per size and decides from the
 * stored durations whether the direction is done. A round whose samples were
 * all discarded stores none, which must not read as having met the threshold.
 */

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

describe('SpeedTest with discarded bandwidth samples', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: { origin: 'https://speed.example.com' }
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps measuring larger sizes after a fully discarded round', async () => {
    const entries: ReturnType<typeof perfEntry>[] = [];
    const ttfbs = [0, 1500];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        entries.push(perfEntry(ttfbs.shift() ?? 1500));
        return new Response('');
      })
    );
    vi.stubGlobal('performance', {
      now: () => 0,
      getEntriesByName: () => entries,
      clearResourceTimings: () => {},
      setResourceTimingBufferSize: () => {}
    });

    const engine = new SpeedTest({
      autoStart: false,
      logAimApiUrl: null,
      measureUploadLoadedLatency: false,
      bandwidthFinishRequestDuration: 1000,
      measurements: [
        { type: 'upload', bytes: 1e5, count: 1 },
        { type: 'upload', bytes: 1e6, count: 1 }
      ]
    });
    const results = new Promise<SpeedTest['results']>(resolve => {
      engine.onFinish = resolve;
    });
    engine.play();

    const uploadPoints = (await results).getUploadBandwidthPoints();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(uploadPoints.map(d => d.bytes)).toEqual([1e6]);
  });
});
