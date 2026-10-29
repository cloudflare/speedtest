import { afterEach, describe, expect, it, vi } from 'vitest';
import SpeedTest, { type ConfigOptions } from '../../src';
import BandwidthEngine from '../../src/engines/BandwidthEngine/BandwidthEngine';

const originalFetch = window.fetch;

afterEach(() => {
  window.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Stamped at lookup time, so the entry always counts as the request's own
const mockPerformanceTiming = () =>
  vi.spyOn(performance, 'getEntriesByName').mockImplementation(() => [
    {
      connectEnd: 0,
      connectStart: 0,
      nextHopProtocol: 'h2',
      requestStart: 0,
      responseEnd: 20,
      responseStart: 10,
      secureConnectionStart: 0,
      startTime: performance.now(),
      transferSize: 1_000
    } as PerformanceResourceTiming
  ]);

const createEngine = (
  measurements: ConfigOptions['measurements'],
  config: ConfigOptions = {}
) =>
  new SpeedTest({
    autoStart: false,
    downloadApiUrl: 'https://example.com/down',
    uploadApiUrl: 'https://example.com/up',
    logAimApiUrl: null,
    logMeasurementApiUrl: null,
    measureDownloadLoadedLatency: false,
    measureUploadLoadedLatency: false,
    measurements,
    ...config
  });

const trackResultErrors = (engine: SpeedTest): string[] => {
  const resultErrors: string[] = [];
  engine.onResultsChange = ({ type }) => {
    const results = engine.results.raw[type];
    if (
      typeof results === 'object' &&
      results.error &&
      !resultErrors.includes(results.error)
    ) {
      resultErrors.push(results.error);
    }
  };
  return resultErrors;
};

describe.each([
  [
    'HTTP 400',
    () => Promise.resolve(new Response(null, { status: 400 })),
    400,
    'Request failed with 400'
  ],
  [
    'HTTP 401',
    () => Promise.resolve(new Response(null, { status: 401 })),
    401,
    'Request failed with 401'
  ],
  [
    'HTTP 403',
    () => Promise.resolve(new Response(null, { status: 403 })),
    403,
    'Request failed with 403'
  ],
  [
    'HTTP 408',
    () => Promise.resolve(new Response(null, { status: 408 })),
    408,
    'Request failed with 408'
  ],
  [
    'HTTP 500',
    () => Promise.resolve(new Response(null, { status: 500 })),
    500,
    'Request failed with 500'
  ],
  [
    'network failure',
    () => Promise.reject(new TypeError('fetch failed')),
    undefined,
    'Connection failed'
  ]
])('bandwidth %s', (_label, respond, status, reason) => {
  it('records the error on each step and finishes the test', async () => {
    const fetchMock = vi.fn(respond);
    window.fetch = fetchMock;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const engine = createEngine([
      { type: 'latency', numPackets: 1 },
      { type: 'download', bytes: 1_000, count: 1 },
      { type: 'upload', bytes: 1_000, count: 1 },
      { type: 'download', bytes: 10_000, count: 1 }
    ]);
    const phases: string[] = [];
    engine.onPhaseChange = ({ measurement }) => phases.push(measurement.type);
    const resultErrors = trackResultErrors(engine);
    const errors: { message: string; status?: number }[] = [];
    engine.onError = (message, responseStatus) =>
      errors.push({ message, status: responseStatus });

    const finished = new Promise(resolve => (engine.onFinish = resolve));
    engine.play();
    await finished;

    // The second download is skipped, as its direction already errored
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(phases).toEqual(['latency', 'download', 'upload', 'download']);
    expect(errors).toEqual(
      ['latency', 'download', 'upload'].map(type => ({
        message: expect.stringContaining(
          `Connection error while measuring ${type}: ${reason}`
        ),
        status
      }))
    );
    expect(resultErrors).toEqual([
      expect.stringContaining(reason),
      expect.stringContaining(reason),
      expect.stringContaining(reason)
    ]);
    expect(engine.isFinished).toBe(true);
    expect(engine.isRunning).toBe(false);
    expect(() => engine.results.getSummary()).not.toThrow();
    expect(() => engine.results.getScores()).not.toThrow();
  });
});

it('stops when paused from onError and resumes at the next step', async () => {
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response(null, { status: 401 }))
  );
  window.fetch = fetchMock;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  const engine = createEngine([
    { type: 'latency', numPackets: 1 },
    { type: 'download', bytes: 1_000, count: 1 }
  ]);
  const phases: string[] = [];
  engine.onPhaseChange = ({ measurement }) => phases.push(measurement.type);
  const onFinish = vi.fn();
  const finished = new Promise(resolve => {
    engine.onFinish = results => {
      onFinish(results);
      resolve(results);
    };
  });

  const errored = new Promise<void>(resolve => {
    engine.onError = () => {
      engine.pause();
      engine.onError = () => {};
      resolve();
    };
  });

  engine.play();
  await errored;
  await new Promise(resolve => setTimeout(resolve, 20));

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(phases).toEqual(['latency']);
  expect(engine.isRunning).toBe(false);
  expect(onFinish).not.toHaveBeenCalled();

  engine.play();
  await finished;

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(phases).toEqual(['latency', 'download']);
});

it('skips the rest of a direction after bandwidthAbortRequestDuration and finishes', async () => {
  mockPerformanceTiming();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);

  const requests: string[] = [];
  const fetchMock = vi.fn(
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(input.toString());
      const bytes = url.searchParams.get('bytes');
      requests.push(`${url.pathname.slice(1)} ${bytes}`);
      if (bytes === '10000000') {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason)
          );
        });
      }
      return Promise.resolve(new Response('ok'));
    }
  );
  window.fetch = fetchMock;

  const engine = createEngine(
    [
      { type: 'download', bytes: 1e5, count: 1 },
      { type: 'upload', bytes: 1e5, count: 1 },
      { type: 'download', bytes: 1e7, count: 1 },
      { type: 'upload', bytes: 5e6, count: 1 },
      { type: 'download', bytes: 2.5e7, count: 1 },
      { type: 'latency', numPackets: 1 }
    ],
    { bandwidthAbortRequestDuration: 50 }
  );
  const errors: string[] = [];
  engine.onError = message => errors.push(message);

  const results = await new Promise<SpeedTest['results']>(resolve => {
    engine.onFinish = resolve;
    engine.play();
  });

  expect(requests).toEqual([
    'down 100000',
    'up 100000',
    'down 10000000',
    'up 5000000',
    'down 0'
  ]);
  expect(errors).toEqual([
    expect.stringContaining('exceeded bandwidthAbortRequestDuration (50ms)')
  ]);
  expect(results.getDownloadBandwidthPoints().map(d => d.bytes)).toEqual([1e5]);
  expect(results.getUploadBandwidthPoints().map(d => d.bytes)).toEqual([
    1e5, 5e6
  ]);
  expect(results.getSummary()).toMatchObject({
    download: expect.any(Number),
    upload: expect.any(Number),
    latency: expect.any(Number)
  });
});

it('reports a failed loaded-latency request and keeps measuring bandwidth', async () => {
  mockPerformanceTiming();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);

  let resolveBandwidthRequest: ((response: Response) => void) | undefined;
  const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(input.toString());
    if (url.searchParams.get('bytes') === '0') {
      setTimeout(() => resolveBandwidthRequest?.(new Response('ok')), 10);
      return Promise.resolve(new Response(null, { status: 401 }));
    }
    return new Promise(resolve => {
      resolveBandwidthRequest = resolve;
    });
  });
  window.fetch = fetchMock;

  const engine = createEngine([{ type: 'download', bytes: 1_000, count: 1 }], {
    measureDownloadLoadedLatency: true
  });
  const resultErrors = trackResultErrors(engine);
  const onError = vi.fn();
  engine.onError = onError;

  const results = await new Promise<SpeedTest['results']>(resolve => {
    engine.onFinish = resolve;
    engine.play();
  });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(onError).toHaveBeenCalledExactlyOnceWith(
    expect.stringMatching(
      /^Connection error while measuring loaded latency: Request failed with 401:/
    ),
    401
  );
  expect(resultErrors).toEqual([]);
  expect(results.getDownloadBandwidthPoints()).toHaveLength(1);
});

describe('abortTestDuration', () => {
  it('aborts the request in flight and finishes with the results so far', async () => {
    mockPerformanceTiming();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const bytes = new URL(input.toString()).searchParams.get('bytes');
        if (bytes !== '10000000') return Promise.resolve(new Response('ok'));
        signals.push(init!.signal!);
        return new Promise((_resolve, reject) =>
          init!.signal!.addEventListener('abort', () =>
            reject(init!.signal!.reason)
          )
        );
      }
    );
    window.fetch = fetchMock;

    const engine = createEngine(
      [
        { type: 'download', bytes: 1e5, count: 1, bypassMinDuration: true },
        { type: 'download', bytes: 1e7, count: 1 },
        { type: 'upload', bytes: 1e5, count: 1 }
      ],
      { abortTestDuration: 100 }
    );
    const errors: string[] = [];
    engine.onError = message => errors.push(message);

    const results = await new Promise<SpeedTest['results']>(resolve => {
      engine.onFinish = resolve;
      engine.play();
    });

    const message = 'Test aborted. Test exceeded abortTestDuration (100ms)';
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(errors).toEqual([message]);
    expect(results.raw.error).toBe(message);
    expect(results.raw.download).toMatchObject({ error: message });
    expect(results.getDownloadBandwidthPoints().map(d => d.bytes)).toEqual([
      1e5
    ]);
    expect(engine.isFinished).toBe(true);
    expect(engine.isRunning).toBe(false);
  });

  it('does not count paused time', async () => {
    mockPerformanceTiming();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    window.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) =>
          init!.signal!.addEventListener('abort', () =>
            reject(init!.signal!.reason)
          )
        )
    );

    const engine = createEngine([{ type: 'download', bytes: 1e5, count: 1 }], {
      abortTestDuration: 500
    });
    const onFinish = vi.fn();
    engine.onFinish = onFinish;

    // Wide margins: the pause alone outlasts the limit
    engine.play();
    await new Promise(resolve => setTimeout(resolve, 100));
    engine.pause();
    await new Promise(resolve => setTimeout(resolve, 600));
    expect(onFinish).not.toHaveBeenCalled();

    const finished = new Promise(resolve => (engine.onFinish = resolve));
    engine.play();
    await finished;
    expect(engine.results.raw.error).toContain('abortTestDuration (500ms)');
  });

  it('is disabled by a negative value', async () => {
    mockPerformanceTiming();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    window.fetch = vi.fn(async () => new Response('ok'));

    const engine = createEngine([{ type: 'download', bytes: 1e5, count: 1 }], {
      abortTestDuration: -1
    });
    const results = await new Promise<SpeedTest['results']>(resolve => {
      engine.onFinish = resolve;
      engine.play();
    });

    expect(results.raw.error).toBeUndefined();
    expect(results.getDownloadBandwidthPoints()).toHaveLength(1);
  });

  it('clears the reason when restarted', async () => {
    mockPerformanceTiming();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    let hang = true;
    window.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        hang
          ? new Promise((_resolve, reject) =>
              init!.signal!.addEventListener('abort', () =>
                reject(init!.signal!.reason)
              )
            )
          : Promise.resolve(new Response('ok'))
    );

    const engine = createEngine([{ type: 'download', bytes: 1e5, count: 1 }], {
      abortTestDuration: 50
    });
    await new Promise(resolve => {
      engine.onFinish = resolve;
      engine.play();
    });
    expect(engine.results.raw.error).toBeDefined();

    hang = false;
    await new Promise(resolve => {
      engine.onFinish = resolve;
      engine.restart();
    });
    expect(engine.results.raw.error).toBeUndefined();
    expect(engine.results.getDownloadBandwidthPoints()).toHaveLength(1);
  });
});

describe.each([
  ['uses Retry-After', '2', 2_000],
  ['waits five seconds when Retry-After is missing', null, 5_000]
])('HTTP 429 %s', (_label, retryAfter, delay) => {
  it('retries three times before failing', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(null, {
          status: 429,
          headers: retryAfter ? { 'retry-after': retryAfter } : undefined
        })
      )
    );
    window.fetch = fetchMock;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const engine = new BandwidthEngine([{ dir: 'down', bytes: 0, count: 1 }], {
      downloadApiUrl: 'https://example.com/down',
      uploadApiUrl: 'https://example.com/up'
    });
    const error = new Promise<{ message: string; status?: number }>(resolve => {
      engine.onConnectionError = (message, responseStatus) =>
        resolve({ message, status: responseStatus });
    });

    engine.play();

    await vi.advanceTimersByTimeAsync(0);
    for (let retry = 1; retry <= 3; retry++) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(fetchMock).toHaveBeenCalledTimes(retry);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(retry + 1);
    }

    await expect(error).resolves.toEqual({
      message: expect.stringContaining('Gave up after 3 retries.'),
      status: 429
    });
  });
});

it('cancels a pending 429 retry when paused', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(null, {
        status: 429,
        headers: { 'retry-after': '1' }
      })
    )
  );
  window.fetch = fetchMock;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  const engine = new BandwidthEngine([{ dir: 'down', bytes: 0, count: 1 }], {
    downloadApiUrl: 'https://example.com/down',
    uploadApiUrl: 'https://example.com/up'
  });

  engine.play();
  await vi.advanceTimersByTimeAsync(0);
  engine.pause();
  await vi.advanceTimersByTimeAsync(1_000);

  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('cancels the old engine 429 retry when restarted', async () => {
  vi.useFakeTimers();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(null, {
        status: 429,
        headers: { 'retry-after': '1' }
      })
    )
    .mockResolvedValue(new Response(null, { status: 401 }));
  window.fetch = fetchMock;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  const engine = createEngine([{ type: 'download', bytes: 1_000, count: 1 }]);

  engine.play();
  await vi.advanceTimersByTimeAsync(0);
  engine.restart();
  await vi.advanceTimersByTimeAsync(1_000);

  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('fails without retrying after a network failure', async () => {
  const fetchMock = vi.fn(() => Promise.reject(new TypeError('fetch failed')));
  window.fetch = fetchMock;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  const engine = new BandwidthEngine([{ dir: 'down', bytes: 0, count: 1 }], {
    downloadApiUrl: 'https://example.com/down',
    uploadApiUrl: 'https://example.com/up'
  });
  const error = new Promise<{ message: string; status?: number }>(resolve => {
    engine.onConnectionError = (message, status) =>
      resolve({ message, status });
  });

  engine.play();

  await expect(error).resolves.toEqual({
    message: expect.stringContaining('Connection failed'),
    status: undefined
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
