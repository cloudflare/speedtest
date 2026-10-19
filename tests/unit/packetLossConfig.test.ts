import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SpeedTest from '../../src';
import type { ConfigOptions } from '../../src/config/defaultConfig.ts';

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

const CREDS_API_URL = 'https://turn.example.com/turn-credentials';
const MISSING_SERVER =
  'No TURN server configured: set turnServerCredsApiUrl or turnServerUri';
const MISSING_CREDENTIALS =
  'No TURN credentials configured: set turnServerCredsApiUrl, or turnServerUser and turnServerPass';

/** Runs a packet loss measurement followed by an upload, until finished. */
async function runPacketLoss(config: ConfigOptions = {}) {
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
    ],
    ...config
  });
  const onError = vi.fn();
  engine.onError = onError;
  const results = new Promise<SpeedTest['results']>(resolve => {
    engine.onFinish = resolve;
  });
  engine.play();

  return { finished: await results, onError };
}

describe('SpeedTest packetLoss TURN config', () => {
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

  it('reports an error and moves on when no TURN server is configured', async () => {
    const { finished, onError } = await runPacketLoss();

    expect(onError).toHaveBeenCalledWith(
      `Error while measuring packet loss: ${MISSING_SERVER}`
    );
    expect(finished.getPacketLossDetails()).toEqual({ error: MISSING_SERVER });
    expect(finished.getUploadBandwidthPoints()).toHaveLength(1);
    expect(finished.isFinished).toBe(true);
  });

  it.each<[string, ConfigOptions]>([
    [
      'a URI without credentials',
      { turnServerUri: 'turn.cloudflare.com:3478' }
    ],
    [
      'a URI with only a username',
      { turnServerUri: 'turn.cloudflare.com:3478', turnServerUser: 'user' }
    ]
  ])('rejects %s', async (_, config) => {
    const { finished } = await runPacketLoss(config);

    expect(finished.getPacketLossDetails()).toEqual({
      error: MISSING_CREDENTIALS
    });
    expect(finished.getUploadBandwidthPoints()).toHaveLength(1);
  });

  it('builds the engine when a credentials API URL is set', async () => {
    const { finished, onError } = await runPacketLoss({
      turnServerCredsApiUrl: CREDS_API_URL
    });

    expect(fetch).toHaveBeenCalledWith(CREDS_API_URL, expect.anything());
    // The stubbed fetch returns no credentials, so the engine itself fails.
    expect(finished.getPacketLossDetails()).toEqual({
      error: 'unable to get turn server credentials'
    });
    expect(onError).not.toHaveBeenCalledWith(
      expect.stringContaining('configured')
    );
    expect(finished.isFinished).toBe(true);
  });

  it('fails early when no TURN server URI is available', async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      Response.json({ username: 'user', credential: 'pass' })
    );
    const { finished, onError } = await runPacketLoss({
      turnServerCredsApiUrl: CREDS_API_URL,
      measurements: [
        {
          type: 'packetLoss',
          numPackets: 10,
          batchSize: 10,
          batchWaitTime: 10,
          responsesWaitTime: 100
        }
      ]
    });

    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('No TURN server URI')
    );
    expect(finished.isFinished).toBe(true);
  });

  it('reports a setup error after construction with autoStart', async () => {
    const engine = new SpeedTest({
      logAimApiUrl: null,
      measurements: [
        {
          type: 'packetLoss',
          numPackets: 10,
          batchSize: 10,
          batchWaitTime: 10,
          responsesWaitTime: 100
        }
      ]
    });
    const onError = vi.fn();
    engine.onError = onError;
    await new Promise(resolve => {
      engine.onFinish = resolve;
    });

    expect(onError).toHaveBeenCalledWith(
      `Error while measuring packet loss: ${MISSING_SERVER}`
    );
  });
});
