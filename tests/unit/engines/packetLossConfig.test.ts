import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SpeedTest from '../../../src';

const perfEntry = () => ({
  startTime: 0,
  requestStart: 10,
  responseStart: 1510,
  responseEnd: 1510,
  transferSize: 0,
  connectStart: 0,
  connectEnd: 0,
  secureConnectionStart: 0,
  nextHopProtocol: 'h2'
});

describe('SpeedTest packetLoss without a TURN server', () => {
  beforeEach(() => {
    const entries: ReturnType<typeof perfEntry>[] = [];
    vi.stubGlobal('window', {
      location: { origin: 'https://speed.example.com' }
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        entries.push(perfEntry());
        return new Response('');
      })
    );
    vi.stubGlobal('performance', {
      now: () => 0,
      getEntriesByName: () => entries,
      clearResourceTimings: () => {},
      setResourceTimingBufferSize: () => {}
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports an error and moves on to the next measurement', async () => {
    const engine = new SpeedTest({
      autoStart: false,
      logAimApiUrl: null,
      measureUploadLoadedLatency: false,
      measurements: [
        {
          type: 'packetLoss',
          numPackets: 10,
          batchSize: 10,
          batchWaitTime: 10,
          responsesWaitTime: 100
        },
        { type: 'upload', bytes: 1e5, count: 1 }
      ]
    });
    const onError = vi.fn();
    engine.onError = onError;
    const results = new Promise<SpeedTest['results']>(resolve => {
      engine.onFinish = resolve;
    });
    engine.play();

    const finished = await results;
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('no TURN server configured')
    );
    expect(finished.getPacketLossDetails()).toEqual({
      error: 'no turn server configured'
    });
    expect(finished.getUploadBandwidthPoints()).toHaveLength(1);
  });
});
