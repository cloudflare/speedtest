import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Captures the load size each packet loss phase is created with
const created: { downloadChunkSize?: number }[] = [];
vi.mock('../../src/engines/PacketLossEngine', () => ({
  default: class {
    onFinished = () => {};
    onConnectionError = () => {};
    onCredentialsFailure = () => {};
    onMsgReceived = () => {};
    results = {};
    constructor(options: { downloadChunkSize?: number }) {
      created.push(options);
      setTimeout(() => this.onFinished());
    }
  }
}));

const { default: SpeedTest } = await import('../../src');

describe('optimal load size after a parallel step', () => {
  beforeEach(() => {
    created.length = 0;
    const entries: { name: string; startTime: number }[] = [];
    let clock = 0;
    vi.stubGlobal('window', {
      location: { origin: 'https://speed.example.com' }
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        entries.push({
          name: url,
          startTime: clock,
          requestStart: 10,
          responseStart: 20,
          responseEnd: 1520,
          transferSize: 0,
          connectStart: 0,
          connectEnd: 0,
          secureConnectionStart: 0,
          nextHopProtocol: 'h2'
        } as { name: string; startTime: number });
        return new Response('');
      })
    );
    vi.stubGlobal('performance', {
      now: () => ++clock,
      getEntriesByName: (name: string) =>
        entries.filter(entry => entry.name === name),
      clearResourceTimings: () => {},
      setResourceTimingBufferSize: () => {}
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is based on the size of one request, not the whole batch', async () => {
    const engine = new SpeedTest({
      autoStart: false,
      logAimApiUrl: null,
      logMeasurementApiUrl: null,
      measureDownloadLoadedLatency: false,
      measurements: [
        { type: 'download', bytes: 1e6, count: 1, parallel: 4 },
        {
          type: 'packetLoss',
          numPackets: 1,
          batchSize: 1,
          batchWaitTime: 10,
          responsesWaitTime: 100,
          loadDown: true
        } as never
      ]
    });

    await new Promise<void>(resolve => {
      engine.onFinish = () => resolve();
      engine.onError = () => resolve();
      engine.play();
    });

    expect(engine.results.getDownloadBandwidthPoints()[0].bytes).toBe(4e6);
    expect(created[0].downloadChunkSize).toBe(5e5);
  });
});
