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
    vi.restoreAllMocks();
  });

  it('measures downloads from the first request to the last completion', () => {
    const result = aggregateRequestTimings(
      [timing(0, 10, 110), timing(5, 20, 120)],
      true,
      1000
    );

    expect(result.duration).toBe(120);
    expect(result.transferredBytes).toBe(2000);
    expect(result.transferSize).toBe(2000);
    expect(result.bps).toBeCloseTo(16000 / 0.12);
  });

  it('estimates bytes missing from resource timing', () => {
    const hiddenTiming = { ...timing(5, 20, 120), transferSize: 0 };
    const result = aggregateRequestTimings(
      [timing(0, 10, 110), hiddenTiming],
      true,
      1000
    );

    expect(result.transferSize).toBe(1000);
    expect(result.bps).toBeCloseTo(((1000 + 1005) * 8) / 0.12);
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

  it('continuously replenishes one request lane per target', async () => {
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
        parallel: true
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

    releases[0]();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(new URL(fetchMock.mock.calls[4][0].toString()).origin).toBe(
      new URL(origins[0]).origin
    );
    releases[4]();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    expect(new URL(fetchMock.mock.calls[5][0].toString()).origin).toBe(
      new URL(origins[0]).origin
    );
    releases.slice(1, 4).forEach(release => release());
    releases[5]();
    await finished;

    expect(engine.results.down[1000].timings).toHaveLength(1);
    expect(engine.results.down[1000].timings[0].transferredBytes).toBe(6000);
    expect(onRequestResult).toHaveBeenCalledTimes(6);
    await vi.waitFor(() => expect(onMeasurementResult).toHaveBeenCalledOnce());
  });

  it('retains completed requests when a parallel step resumes', async () => {
    const releases: Array<() => void> = [];
    const fetchMock = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          releases.push(() => resolve(new Response('body')));
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason),
            { once: true }
          );
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { location: { origin: 'https://app.example' } });
    vi.stubGlobal('performance', {
      clearResourceTimings: vi.fn(),
      getEntriesByName: () => [
        {
          transferSize: 1000,
          requestStart: 0,
          responseStart: 10,
          responseEnd: 110,
          connectStart: 0,
          connectEnd: 0,
          secureConnectionStart: 0,
          nextHopProtocol: 'h2'
        }
      ]
    });

    const engine = new BandwidthEngine(
      [{ dir: 'down', bytes: 1000, count: 4 }],
      {
        downloadApiUrls: [
          'https://speed-0.example/__down',
          'https://speed-1.example/__down'
        ],
        uploadApiUrl: 'https://upload.example/__up',
        parallel: true
      }
    );
    const onRequestResult = vi.fn();
    engine.onRequestResult = onRequestResult;
    onRequestResult.mockImplementationOnce(() => engine.pause());
    const finished = new Promise(resolve => {
      engine.onFinished = resolve;
    });

    engine.play();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    releases[0]();
    await vi.waitFor(() => expect(onRequestResult).toHaveBeenCalledOnce());
    engine.play();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    releases[2]();
    releases[3]();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    releases[4]();
    await finished;

    expect(onRequestResult).toHaveBeenCalledTimes(4);
    expect(engine.results.down[1000].timings[0].transferredBytes).toBe(4000);
  });

  it('rotates sequential requests from a randomized target', async () => {
    const fetchMock = vi.fn((url: RequestInfo | URL) =>
      Promise.resolve(new Response(url.toString()))
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { location: { origin: 'https://app.example' } });
    vi.stubGlobal('performance', {
      now: vi.fn(() => 1),
      clearResourceTimings: vi.fn(),
      setResourceTimingBufferSize: vi.fn(),
      getEntriesByName: () => [
        {
          transferSize: 1000,
          requestStart: 0,
          responseStart: 10,
          responseEnd: 110,
          connectStart: 0,
          connectEnd: 0,
          secureConnectionStart: 0,
          nextHopProtocol: 'h2'
        }
      ]
    });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const engine = new SpeedTest({
      autoStart: false,
      measurementTargets: [
        'https://speed-0.example',
        'https://speed-1.example',
        'https://speed-1.example'
      ],
      measurements: [{ type: 'download', bytes: 1000, count: 3 }],
      measureDownloadLoadedLatency: false,
      logAimApiUrl: null
    });
    const finished = new Promise<typeof engine.results>((resolve, reject) => {
      engine.onFinish = resolve;
      engine.onError = reject;
    });

    engine.play();
    await finished;

    expect(
      fetchMock.mock.calls.map(([url]) => new URL(url.toString()).origin)
    ).toEqual([
      'https://speed-1.example',
      'https://speed-1.example',
      'https://speed-0.example'
    ]);
  });

  it('applies measurement targets and step parallelism through the public API', async () => {
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
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const engine = new SpeedTest({
      autoStart: false,
      measurementTargets: [
        'https://speed-0.example',
        'https://speed-1.example'
      ],
      measurements: [
        { type: 'download', bytes: 1000, count: 2, parallel: true },
        { type: 'upload', bytes: 1000, count: 4, parallel: true }
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
    expect(body.sessionId).toBe('session=abc&parallel=2');
    expect(body.download).toEqual([expect.objectContaining({ bytes: 2000 })]);
    expect(body.upload).toEqual([expect.objectContaining({ bytes: 4000 })]);
  });
});

describe('parallel session metadata', () => {
  it('appends the target count', () => {
    expect(appendParallelism('session=abc&tier=test', 4)).toBe(
      'session=abc&tier=test&parallel=4'
    );
  });

  it('replaces an existing parallelism value', () => {
    expect(appendParallelism('session=abc&parallel=2', 4)).toBe(
      'session=abc&parallel=4'
    );
  });

  it('removes metadata for sequential sessions', () => {
    expect(appendParallelism('session=abc&parallel=2', undefined)).toBe(
      'session=abc'
    );
    expect(appendParallelism(undefined, 4)).toBeUndefined();
  });
});
