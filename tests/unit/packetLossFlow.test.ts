import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Lets each test finish or fail the packet loss phase on demand
const instances: {
  onFinished: () => void;
  onCredentialsFailure: (error: string) => void;
}[] = [];
let throwOnCreate = false;
vi.mock('../../src/engines/PacketLossEngine', () => ({
  default: class {
    onFinished = () => {};
    onConnectionError = () => {};
    onCredentialsFailure = () => {};
    onMsgReceived = () => {};
    results = {};
    constructor() {
      if (throwOnCreate) throw new Error('No TURN server configured');
      instances.push(this);
    }
  }
}));

const { default: SpeedTest } = await import('../../src');

const perfEntry = () => ({
  startTime: 0,
  requestStart: 10,
  responseStart: 20,
  responseEnd: 30,
  transferSize: 1_000,
  connectStart: 0,
  connectEnd: 0,
  secureConnectionStart: 0,
  nextHopProtocol: 'h2'
});

const createEngine = () =>
  new SpeedTest({
    autoStart: false,
    logAimApiUrl: null,
    logMeasurementApiUrl: null,
    measureDownloadLoadedLatency: false,
    measurements: [
      {
        type: 'packetLoss',
        numPackets: 1,
        batchSize: 1,
        batchWaitTime: 10,
        responsesWaitTime: 100
      },
      { type: 'download', bytes: 1_000, count: 1, bypassMinDuration: true }
    ]
  });

describe('SpeedTest packet loss phase', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    instances.length = 0;
    throwOnCreate = false;
    const entries: ReturnType<typeof perfEntry>[] = [];
    vi.stubGlobal('window', {
      location: { origin: 'https://speed.example.com' }
    });
    fetchMock = vi.fn(async () => {
      entries.push({ ...perfEntry(), startTime: entries.length + 1 });
      return new Response('');
    });
    vi.stubGlobal('fetch', fetchMock);
    let clock = 0;
    vi.stubGlobal('performance', {
      now: () => clock++,
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

  it('does not start the next phase when it finishes while paused', async () => {
    const engine = createEngine();
    const phases: string[] = [];
    engine.onPhaseChange = ({ measurement }) => phases.push(measurement.type);

    engine.play();
    engine.pause();
    instances[0].onFinished();

    expect(phases).toEqual(['packetLoss']);
    expect(fetchMock).not.toHaveBeenCalled();

    const finished = new Promise(resolve => (engine.onFinish = resolve));
    engine.play();
    await finished;
    expect(phases).toEqual(['packetLoss', 'download']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('runs a single test when restarted from onError', async () => {
    const engine = createEngine();
    const phases: string[] = [];
    engine.onPhaseChange = ({ measurement }) => phases.push(measurement.type);
    let restarted = false;
    engine.onError = () => {
      if (restarted) return;
      restarted = true;
      engine.restart();
    };

    engine.play();
    instances[0].onCredentialsFailure('nope');

    // The old run's error handler must not advance the restarted run
    expect(phases).toEqual(['packetLoss', 'packetLoss']);
    expect(fetchMock).not.toHaveBeenCalled();

    const finished = new Promise(resolve => (engine.onFinish = resolve));
    instances[1].onCredentialsFailure('nope');
    await finished;
    expect(phases).toEqual(['packetLoss', 'packetLoss', 'download']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('runs a single test when restarted from a setup error', async () => {
    throwOnCreate = true;
    const engine = createEngine();
    const errors: string[] = [];
    engine.onError = message => {
      errors.push(message);
      if (errors.length === 1) engine.restart();
    };
    let errorsAtDownload: number | undefined;
    engine.onPhaseChange = ({ measurement }) => {
      if (measurement.type === 'download') errorsAtDownload ??= errors.length;
    };

    const finished = new Promise(resolve => (engine.onFinish = resolve));
    engine.play();
    await finished;

    // The download must wait for the restarted run's own packet loss error
    expect(errorsAtDownload).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
