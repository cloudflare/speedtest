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
  it('skips each failed request and runs every step', async () => {
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

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(phases).toEqual(['latency', 'download', 'upload', 'download']);
    expect(errors).toEqual(
      ['latency', 'download', 'upload', 'download'].map(type => ({
        message: expect.stringContaining(
          `Connection error while measuring ${type}: ${reason}`
        ),
        status
      }))
    );
    // A failed request doesn't end its step, so no step records an error
    expect(resultErrors).toEqual([]);
    expect(engine.isFinished).toBe(true);
    expect(engine.isRunning).toBe(false);
    expect(() => engine.results.getSummary()).not.toThrow();
    expect(() => engine.results.getScores()).not.toThrow();
  });
});

it('stops when paused from onError and retries the request on resume', async () => {
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

  // The paused latency request is sent again, then the download
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(phases).toEqual(['latency', 'download']);
});

it('skips each request that exceeds bandwidthAbortRequestDuration and runs every step', async () => {
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
      { type: 'download', bytes: 1e7, count: 2 },
      { type: 'upload', bytes: 5e6, count: 1 },
      { type: 'download', bytes: 2.5e7, count: 1 },
      { type: 'latency', numPackets: 1 }
    ],
    { bandwidthAbortRequestDuration: 50 }
  );
  const resultErrors = trackResultErrors(engine);
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
    'down 10000000',
    'up 5000000',
    'down 25000000',
    'down 0'
  ]);
  expect(errors).toEqual([
    expect.stringContaining('exceeded bandwidthAbortRequestDuration (50ms)'),
    expect.stringContaining('exceeded bandwidthAbortRequestDuration (50ms)')
  ]);
  expect(resultErrors).toEqual([]);
  expect(results.getDownloadBandwidthPoints().map(d => d.bytes)).toEqual([
    1e5, 2.5e7
  ]);
  expect(results.getUploadBandwidthPoints().map(d => d.bytes)).toEqual([
    1e5, 5e6
  ]);
  expect(results.getSummary()).toMatchObject({
    download: expect.any(Number),
    upload: expect.any(Number),
    latency: expect.any(Number)
  });
});

it.each([500, 401, 403])(
  'skips a %i mid-step and carries on with the step',
  async status => {
    mockPerformanceTiming();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const requests: string[] = [];
    let downloads = 0;
    window.fetch = vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(input.toString());
      requests.push(
        `${url.pathname.slice(1)} ${url.searchParams.get('bytes')}`
      );
      const failed = url.pathname === '/down' && ++downloads === 3;
      return Promise.resolve(
        new Response('ok', { status: failed ? status : 200 })
      );
    });

    const engine = createEngine([
      { type: 'download', bytes: 1e5, count: 4 },
      { type: 'upload', bytes: 1e5, count: 1 },
      { type: 'download', bytes: 1e6, count: 1 }
    ]);
    const errors: { message: string; status?: number }[] = [];
    engine.onError = (message, responseStatus) =>
      errors.push({ message, status: responseStatus });

    const results = await new Promise<SpeedTest['results']>(resolve => {
      engine.onFinish = resolve;
      engine.play();
    });

    expect(requests).toEqual([
      'down 100000',
      'down 100000',
      'down 100000',
      'down 100000',
      'up 100000',
      'down 1000000'
    ]);
    expect(errors).toEqual([
      {
        message: expect.stringContaining(
          `Connection error while measuring download: Request failed with ${status}`
        ),
        status
      }
    ]);
    expect(results.getDownloadBandwidthPoints().map(d => d.bytes)).toEqual([
      1e5, 1e5, 1e5, 1e6
    ]);
    expect(results.getUploadBandwidthPoints()).toHaveLength(1);
  }
);

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

it.each([500, 401, 403])(
  'skips a mid-step %i and carries on with the step',
  async status => {
    mockPerformanceTiming();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const requests: string[] = [];
    let downloads = 0;
    window.fetch = vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(input.toString());
      requests.push(
        `${url.pathname.slice(1)} ${url.searchParams.get('bytes')}`
      );
      const failed = url.pathname === '/down' && ++downloads === 3;
      return Promise.resolve(
        new Response(failed ? null : 'ok', { status: failed ? status : 200 })
      );
    });

    const engine = createEngine([
      { type: 'download', bytes: 1e5, count: 4 },
      { type: 'upload', bytes: 1e5, count: 1 },
      { type: 'download', bytes: 1e6, count: 1 }
    ]);
    const errors: { message: string; status?: number }[] = [];
    engine.onError = (message, errorStatus) =>
      errors.push({ message, status: errorStatus });

    const results = await new Promise<SpeedTest['results']>(resolve => {
      engine.onFinish = resolve;
      engine.play();
    });

    expect(requests).toEqual([
      'down 100000',
      'down 100000',
      'down 100000',
      'down 100000',
      'up 100000',
      'down 1000000'
    ]);
    expect(errors).toEqual([
      {
        message: expect.stringContaining(
          `Connection error while measuring download: Request failed with ${status}`
        ),
        status
      }
    ]);
    expect(results.getDownloadBandwidthPoints().map(d => d.bytes)).toEqual([
      1e5, 1e5, 1e5, 1e6
    ]);
    expect(results.raw.download).not.toHaveProperty('error');
  }
);

it('stops the test after three missing resource timing entries in a row', async () => {
  vi.spyOn(performance, 'getEntriesByName').mockReturnValue([]);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const fetchMock = vi.fn(() => Promise.resolve(new Response('ok')));
  window.fetch = fetchMock;

  const engine = createEngine([
    { type: 'download', bytes: 1e5, count: 5 },
    { type: 'upload', bytes: 1e5, count: 1 }
  ]);
  const onFinish = vi.fn();
  engine.onFinish = onFinish;
  const errored = new Promise<string>(resolve => (engine.onError = resolve));

  engine.play();
  const message = await errored;
  await new Promise(resolve => setTimeout(resolve, 50));

  expect(message).toContain(
    'Connection error while measuring download: No resource timing entries'
  );
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(engine.isRunning).toBe(false);
  expect(engine.results.raw.download).toMatchObject({
    error: expect.stringContaining('No resource timing entries')
  });

  engine.play();
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(onFinish).not.toHaveBeenCalled();
});

it('keeps sampling loaded latency after a failed request', async () => {
  mockPerformanceTiming();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);

  let pings = 0;
  window.fetch = vi.fn((input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(input.toString());
    if (url.searchParams.get('bytes') === '0') {
      const status = ++pings === 1 ? 500 : 200;
      return Promise.resolve(new Response('ok', { status }));
    }
    return new Promise(resolve =>
      setTimeout(() => resolve(new Response('ok')), 150)
    );
  });

  const engine = createEngine([{ type: 'download', bytes: 1_000, count: 1 }], {
    measureDownloadLoadedLatency: true,
    loadedLatencyThrottle: 10
  });
  const onError = vi.fn();
  engine.onError = onError;

  await new Promise(resolve => {
    engine.onFinish = resolve;
    engine.play();
  });

  expect(onError).toHaveBeenCalledOnce();
  const download = engine.results.raw.download!.results as Record<
    number,
    { sideLatency: unknown[] }
  >;
  expect(download[1_000].sideLatency.length).toBeGreaterThan(0);
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

it('drops a pending 429 retry when the request is aborted', async () => {
  vi.useFakeTimers();
  let calls = 0;
  const fetchMock = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (++calls === 1)
        return Promise.resolve(
          new Response(null, { status: 429, headers: { 'retry-after': '1' } })
        );
      return new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(init.signal?.reason)
        )
      );
    }
  );
  window.fetch = fetchMock;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  const engine = new BandwidthEngine([{ dir: 'down', bytes: 0, count: 5 }], {
    downloadApiUrl: 'https://example.com/down',
    uploadApiUrl: 'https://example.com/up'
  });
  engine.abortRequestDuration = 900;

  engine.play();
  // The abort fires during the 1 s backoff and moves on to the next request
  await vi.advanceTimersByTimeAsync(1_100);
  engine.pause();

  expect(fetchMock).toHaveBeenCalledTimes(2);
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
