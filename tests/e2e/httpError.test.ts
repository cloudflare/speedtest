import { afterEach, describe, expect, it, vi } from 'vitest';
import SpeedTest from '../../src';
import BandwidthEngine from '../../src/engines/BandwidthEngine/BandwidthEngine';

const originalFetch = window.fetch;

afterEach(() => {
  window.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe.each([400, 401, 403, 500])('bandwidth HTTP %i', status => {
  it('stops the top-level engine without retrying or advancing', async () => {
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
  });
});

it('retains the existing retry behavior for network failures', async () => {
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
    message: expect.stringContaining('Gave up after 20 retries.'),
    status: undefined
  });
  expect(fetchMock).toHaveBeenCalledTimes(21);
});
