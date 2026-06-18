import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import logAimResults from '../../../src/logging/logFinalResults.ts';
import type Results from '../../../src/Results';

/** Minimal Results stub — logAimResults only calls these getters. */
const makeResults = (): Results =>
  ({
    getUnloadedLatencyPoints: () => [],
    getDownloadBandwidthPoints: () => [],
    getUploadBandwidthPoints: () => [],
    getDownLoadedLatencyPoints: () => [],
    getUpLoadedLatencyPoints: () => [],
    getPacketLossDetails: () => undefined,
    getTotalDurationMs: () => 1234,
    getScores: () => undefined
  }) as unknown as Results;

const config = {
  apiUrl: 'https://aim.example.com/__results',
  sessionId: undefined
};

describe('logAimResults', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the results to the configured apiUrl', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await logAimResults(makeResults(), config);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(config.apiUrl);
    expect(init.method).toBe('POST');
    // The module's main job is formatting logData — assert it lands in the body.
    const body = JSON.parse(init.body);
    expect(body.totalDurationMs).toBe(1234);
  });

  it('resolves with the parsed response body (e.g. requestId)', async () => {
    const requestId = '11111111-2222-3333-4444-555555555555';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ requestId }), { status: 200 })
        )
    );

    const result = await logAimResults(makeResults(), config);

    expect(result).toEqual({ requestId });
  });

  it('resolves with { requestId: undefined } on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('nope', { status: 500 }))
    );

    expect(await logAimResults(makeResults(), config)).toEqual({
      requestId: undefined
    });
  });

  it('resolves with { requestId: undefined } when the request rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down'))
    );

    expect(await logAimResults(makeResults(), config)).toEqual({
      requestId: undefined
    });
  });

  it('resolves with { requestId: undefined } when the response body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not json', { status: 200 }))
    );

    expect(await logAimResults(makeResults(), config)).toEqual({
      requestId: undefined
    });
  });
});
