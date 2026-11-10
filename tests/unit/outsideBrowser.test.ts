import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SpeedTest from '../../src';
import BandwidthEngine, {
  type BandwidthEngineResults
} from '../../src/engines/BandwidthEngine/BandwidthEngine';

/**
 * Outside a browser, as in Node, there's no `location` to resolve relative
 * URLs against, and resource timing entries leave out `nextHopProtocol`.
 */

/** A resource timing entry as Node records it: no `nextHopProtocol`. */
const nodeEntry = (name: string, startTime: number) => ({
  name,
  startTime,
  requestStart: 10,
  responseStart: 310,
  responseEnd: 310,
  transferSize: 0,
  connectStart: 0,
  connectEnd: 0,
  secureConnectionStart: 0
});

/** A resource timing entry as a browser records it. */
const browserEntry = (name: string, startTime: number) => ({
  ...nodeEntry(name, startTime),
  nextHopProtocol: 'h2'
});

/** Answers every request, recording an entry for it made by `entry`. */
const stubNetwork = (entry: typeof nodeEntry) => {
  const entries: ReturnType<typeof nodeEntry>[] = [];
  // Advances once per request, so each entry is stamped with its own request
  let clock = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      entries.push(entry(url, clock));
      return new Response('');
    })
  );
  vi.stubGlobal('performance', {
    now: () => ++clock,
    getEntriesByName: (name: string) =>
      entries.filter(found => found.name === name),
    clearResourceTimings: () => {},
    setResourceTimingBufferSize: () => {}
  });
};

/** Runs two uploads against absolute URLs, resolving when the engine ends. */
const measureUploads = () => {
  const engine = new BandwidthEngine([{ dir: 'up', bytes: 1e5, count: 2 }], {
    downloadApiUrl: 'https://speed.example.com/__down',
    uploadApiUrl: 'https://speed.example.com/__up'
  });
  engine.getServerTime = null;
  const onConnectionError = vi.fn();
  engine.onConnectionError = onConnectionError;
  return new Promise<{
    results: BandwidthEngineResults;
    onConnectionError: typeof onConnectionError;
  }>((resolve, reject) => {
    engine.onFinished = results => resolve({ results, onConnectionError });
    engine.onFatalError = error => reject(new Error(error));
    engine.play();
  });
};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BandwidthEngine outside a browser', () => {
  it('measures against absolute URLs without a page origin', async () => {
    expect(typeof location).toBe('undefined');
    stubNetwork(browserEntry);

    const { results, onConnectionError } = await measureUploads();

    expect(fetch).toHaveBeenCalledWith(
      'https://speed.example.com/__up?bytes=100000',
      expect.anything()
    );
    expect(onConnectionError).not.toHaveBeenCalled();
    expect(results.up[1e5].timings).toHaveLength(2);
  });

  it('keeps samples whose entries have no nextHopProtocol', async () => {
    stubNetwork(nodeEntry);

    const { results, onConnectionError } = await measureUploads();

    expect(onConnectionError).not.toHaveBeenCalled();
    expect(results.up[1e5].timings).toHaveLength(2);
  });
});

describe('SpeedTest relative API URLs', () => {
  const config = {
    logAimApiUrl: null,
    downloadApiUrl: '/__down',
    uploadApiUrl: '/__up',
    measurements: [{ type: 'latency' as const, numPackets: 1 }]
  };

  it('reports one through onError outside a browser and ends the test', async () => {
    expect(typeof location).toBe('undefined');
    stubNetwork(nodeEntry);

    // Started on construction, before onError is set
    const engine = new SpeedTest(config);
    const onError = vi.fn();
    engine.onError = onError;
    await new Promise(resolve => {
      engine.onFinish = resolve;
    });

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      expect.stringMatching(/"\/__down".*absolute/)
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(engine.isFinished).toBe(true);
  });

  it('resolves one against the page origin in a browser', async () => {
    vi.stubGlobal('location', { origin: 'https://speed.example.com' });
    stubNetwork(browserEntry);

    const engine = new SpeedTest({ ...config, autoStart: false });
    const onError = vi.fn();
    engine.onError = onError;
    const finished = new Promise(resolve => {
      engine.onFinish = resolve;
    });
    engine.play();
    await finished;

    expect(onError).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/speed\.example\.com\/__down\?/),
      expect.anything()
    );
  });
});
