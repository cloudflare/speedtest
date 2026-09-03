import { afterEach, describe, expect, it, vi } from 'vitest';
import SpeedTest from '../../src';
import BandwidthEngine from '../../src/engines/BandwidthEngine/BandwidthEngine';

const originalFetch = window.fetch;

afterEach(() => {
  window.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each([400, 401, 403, 408, 500])('bandwidth HTTP %i', status => {
  it('stops the top-level engine without retrying, advancing, or resuming', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(null, { status }))
    );
    window.fetch = fetchMock;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const engine = new SpeedTest({
      autoStart: false,
      downloadApiUrl: 'https://example.com/down',
      uploadApiUrl: 'https://example.com/up',
      logAimApiUrl: null,
      logMeasurementApiUrl: null,
      measurements: [
        { type: 'latency', numPackets: 1 },
        { type: 'download', bytes: 1_000, count: 1 }
      ]
    });
    const phases: string[] = [];
    const onFinish = vi.fn();
    engine.onPhaseChange = ({ measurement }) => phases.push(measurement.type);
    engine.onFinish = onFinish;

    const error = new Promise<{
      message: string;
      running: boolean;
      status?: number;
    }>(resolve => {
      engine.onError = (message, responseStatus) => {
        resolve({
          message,
          running: engine.isRunning,
          status: responseStatus
        });
      };
    });

    engine.play();

    await expect(error).resolves.toEqual({
      message: expect.stringMatching(
        new RegExp(`^Request failed with ${status}: https://example\\.com/down`)
      ),
      running: false,
      status
    });
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(['latency']);
    expect(onFinish).not.toHaveBeenCalled();

    engine.play();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

it('stops and cannot resume after a loaded-latency error', async () => {
  const fetchMock = vi.fn(
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(input.toString());
      if (url.searchParams.get('bytes') === '0') {
        return Promise.resolve(new Response(null, { status: 401 }));
      }
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(init.signal?.reason)
        );
      });
    }
  );
  window.fetch = fetchMock;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  const engine = new SpeedTest({
    autoStart: false,
    downloadApiUrl: 'https://example.com/down',
    uploadApiUrl: 'https://example.com/up',
    logAimApiUrl: null,
    logMeasurementApiUrl: null,
    measureDownloadLoadedLatency: true,
    measurements: [{ type: 'download', bytes: 1_000, count: 1 }]
  });
  const error = new Promise<{ running: boolean; status?: number }>(resolve => {
    engine.onError = (_message, status) => {
      resolve({ running: engine.isRunning, status });
    };
  });

  engine.play();

  await expect(error).resolves.toEqual({ running: false, status: 401 });
  expect(fetchMock).toHaveBeenCalledTimes(2);

  engine.play();
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('stops immediately after a network failure', async () => {
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
