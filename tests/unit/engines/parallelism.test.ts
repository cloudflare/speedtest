import { afterEach, describe, expect, it, vi } from 'vitest';
import SpeedTest from '../../../src/index.ts';
import { appendParallelism } from '../../../src/utils/parallelism.ts';
import BandwidthEngine, {
  aggregateRequestTimings,
  type RequestTiming
} from '../../../src/engines/BandwidthEngine/BandwidthEngine.ts';

const timing = (
  requestStart: number,
  responseStart: number,
  responseEnd: number
): RequestTiming => ({
  requestStart,
  responseStart,
  responseEnd,
  transferSize: 1000,
  ttfb: responseStart - requestStart,
  payloadDownloadTime: responseEnd - responseStart,
  serverTime: 2,
  measTime: new Date(),
  ping: 8,
  duration: responseEnd - requestStart,
  bps: 1
});

describe('parallel bandwidth aggregation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('measures downloads from the first response byte to the last completion', () => {
    const result = aggregateRequestTimings(
      [timing(0, 10, 110), timing(5, 20, 120)],
      true,
      1000
    );

    expect(result.duration).toBe(110);
    expect(result.transferredBytes).toBe(2000);
    expect(result.transferSize).toBe(2000);
    expect(result.bps).toBeCloseTo(16000 / 0.11);
  });

  it('estimates bytes missing from resource timing', () => {
    const hiddenTiming = { ...timing(5, 20, 120), transferSize: 0 };
    const result = aggregateRequestTimings(
      [timing(0, 10, 110), hiddenTiming],
      true,
      1000
    );

    expect(result.transferSize).toBe(1000);
    expect(result.bps).toBeCloseTo(((1000 + 1005) * 8) / 0.11);
  });

  it('measures uploads from the first request start to the last response', () => {
    const result = aggregateRequestTimings(
      [timing(0, 100, 105), timing(10, 120, 125)],
      false,
      1000
    );

    expect(result.duration).toBe(120);
    expect(result.transferredBytes).toBe(2000);
    expect(result.bps).toBeCloseTo(16080 / 0.12);
  });

  it('preserves sequential timing calculations', () => {
    const singleTiming = timing(0, 10, 110);
    expect(aggregateRequestTimings([singleTiming], true, 1000)).toBe(
      singleTiming
    );
  });

  it('starts a batch across all configured origins', async () => {
    const releases: Array<() => void> = [];
    const fetchMock = vi.fn(
      (_url: RequestInfo | URL) =>
        new Promise<Response>(resolve => {
          releases.push(() => resolve(new Response('body')));
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { location: { origin: 'https://app.example' } });
    vi.stubGlobal('performance', {
      clearResourceTimings: vi.fn(),
      getEntriesByName: (url: string) => {
        const index = Number(
          new URL(url).searchParams.get('__cf_speedtest_request')?.split('-')[1]
        );
        return [
          {
            transferSize: 1000,
            requestStart: 0,
            responseStart: 10 + index,
            responseEnd: 110 + index,
            connectStart: 0,
            connectEnd: 0,
            secureConnectionStart: 0,
            nextHopProtocol: 'h2'
          }
        ];
      }
    });

    const origins = Array.from(
      { length: 4 },
      (_, index) => `https://t${index}.example/__down`
    );
    const engine = new BandwidthEngine(
      [{ dir: 'down', bytes: 1000, count: 6 }],
      {
        downloadApiUrls: origins,
        uploadApiUrl: 'https://upload.example/__up',
        parallelism: 4
      }
    );
    const onRequestResult = vi.fn();
    const onMeasurementResult = vi.fn();
    engine.onRequestResult = onRequestResult;
    engine.onMeasurementResult = onMeasurementResult;
    const finished = new Promise(resolve => {
      engine.onFinished = resolve;
    });

    engine.play();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(
      fetchMock.mock.calls.map(([url]) => new URL(url.toString()).origin)
    ).toEqual(origins.map(origin => new URL(origin).origin));

    releases.slice(0, 4).forEach(release => release());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    releases.slice(4).forEach(release => release());
    await finished;

    expect(engine.results.down[1000].timings).toHaveLength(2);
    expect(engine.results.down[1000].timings[0].transferredBytes).toBe(4000);
    expect(engine.results.down[1000].timings[1].transferredBytes).toBe(2000);
    expect(onRequestResult).toHaveBeenCalledTimes(6);
    await vi.waitFor(() =>
      expect(onMeasurementResult).toHaveBeenCalledTimes(2)
    );
  });

  it('applies global and step parallelism through the public API', async () => {
    const resultsUrl = 'https://results.example/__results';
    const fetchMock = vi.fn((url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        new Response(url.toString() === resultsUrl ? '{}' : url.toString())
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { location: { origin: 'https://app.example' } });
    vi.stubGlobal('performance', {
      now: vi.fn(() => 1),
      clearResourceTimings: vi.fn(),
      setResourceTimingBufferSize: vi.fn(),
      getEntriesByName: (url: string) => {
        const index = Number(
          new URL(url).searchParams.get('__cf_speedtest_request')?.split('-')[1]
        );
        return [
          {
            transferSize: 1000,
            requestStart: 0,
            responseStart: 10 + index,
            responseEnd: 110 + index,
            connectStart: 0,
            connectEnd: 0,
            secureConnectionStart: 0,
            nextHopProtocol: 'h2'
          }
        ];
      }
    });

    const engine = new SpeedTest({
      autoStart: false,
      bandwidthOrigins: ['https://speed-0.example', 'https://speed-1.example'],
      parallelism: 4,
      measurements: [
        { type: 'download', bytes: 1000, count: 2, parallelism: 2 },
        { type: 'upload', bytes: 1000, count: 4 }
      ],
      measureDownloadLoadedLatency: false,
      measureUploadLoadedLatency: false,
      logAimApiUrl: resultsUrl,
      sessionId: 'session=abc'
    });
    const finished = new Promise<typeof engine.results>((resolve, reject) => {
      engine.onFinish = resolve;
      engine.onError = reject;
    });
    const logged = new Promise(resolve => {
      engine.onResultsLogged = resolve;
    });

    engine.play();
    const results = await finished;
    await logged;

    const measurementCalls = fetchMock.mock.calls.filter(
      ([url]) => url.toString() !== resultsUrl
    );
    const urls = measurementCalls.map(([url]) => new URL(url.toString()));
    expect(urls.map(url => `${url.origin}${url.pathname}`)).toEqual([
      'https://speed-0.example/__down',
      'https://speed-1.example/__down',
      'https://speed-0.example/__up',
      'https://speed-1.example/__up',
      'https://speed-0.example/__up',
      'https://speed-1.example/__up'
    ]);
    expect(results.getDownloadBandwidthPoints()[0].bytes).toBe(2000);
    expect(results.getUploadBandwidthPoints()[0].bytes).toBe(4000);

    const resultsCall = fetchMock.mock.calls.find(
      ([url]) => url.toString() === resultsUrl
    );
    const body = JSON.parse(resultsCall?.[1]?.body as string);
    expect(body.sessionId).toBe('session=abc&parallel=4');
    expect(body.download).toEqual([expect.objectContaining({ bytes: 2000 })]);
    expect(body.upload).toEqual([expect.objectContaining({ bytes: 4000 })]);
  });
});

describe('parallel session metadata', () => {
  it('appends the maximum parallelism', () => {
    expect(appendParallelism('session=abc&tier=test', 4)).toBe(
      'session=abc&tier=test&parallel=4'
    );
  });

  it('replaces an existing parallelism value', () => {
    expect(appendParallelism('session=abc&parallel=2', 4)).toBe(
      'session=abc&parallel=4'
    );
  });

  it('leaves sequential and absent sessions unchanged', () => {
    expect(appendParallelism('session=abc', 1)).toBe('session=abc');
    expect(appendParallelism(undefined, 4)).toBeUndefined();
  });
});
