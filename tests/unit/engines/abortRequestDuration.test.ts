import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SpeedTest from '../../../src';

const perfEntry = (duration: number) => ({
  startTime: 0,
  requestStart: 10,
  responseStart: 10 + duration,
  responseEnd: 10 + duration,
  transferSize: 1000,
  connectStart: 0,
  connectEnd: 0,
  secureConnectionStart: 0,
  nextHopProtocol: 'h2'
});

describe('bandwidthAbortRequestDuration regression test (#163)', () => {
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

  it('completes the speed test and skips remaining measurements of that type when a measurement exceeds bandwidthAbortRequestDuration', async () => {
    const entries: ReturnType<typeof perfEntry>[] = [];
    const requestedBytes: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          const url = new URL(input.toString());
          const bytes = url.searchParams.get('bytes') ?? '';
          requestedBytes.push(bytes);
          if (bytes === '10000000') {
            // Slow link: simulate pending request that is aborted when timeout fires
            return new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError'))
              );
            });
          }
          entries.push(perfEntry(100));
          return Promise.resolve(new Response('ok'));
        }
      )
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
      measureDownloadLoadedLatency: false,
      measureUploadLoadedLatency: false,
      bandwidthAbortRequestDuration: 30,
      measurements: [
        { type: 'download', bytes: 1e5, count: 1 },
        { type: 'download', bytes: 1e7, count: 1 },
        { type: 'download', bytes: 2.5e7, count: 1 },
        { type: 'upload', bytes: 1e5, count: 1 }
      ]
    });

    const errors: string[] = [];
    engine.onError = message => errors.push(message);

    const results = await new Promise<SpeedTest['results']>(resolve => {
      engine.onFinish = resolve;
      engine.play();
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('bandwidthAbortRequestDuration');

    // 25M download was skipped because 10M exceeded bandwidthAbortRequestDuration
    expect(requestedBytes).toEqual(['100000', '10000000', '100000']);

    const downloadPoints = results.getDownloadBandwidthPoints();
    const uploadPoints = results.getUploadBandwidthPoints();

    expect(downloadPoints.map(d => d.bytes)).toEqual([1e5]);
    expect(uploadPoints.map(d => d.bytes)).toEqual([1e5]);
  });
});
