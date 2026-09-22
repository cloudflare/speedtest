import { afterEach, describe, expect, it, vi } from 'vitest';
import SpeedTest from '../../src';

describe('final results logging', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('propagates includeCredentials to the results request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{}', {
        headers: { 'content-type': 'application/json' },
        status: 200
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const engine = new SpeedTest({
      autoStart: false,
      includeCredentials: true,
      logAimApiUrl: 'https://example.com/__results',
      measurements: []
    });
    const logged = new Promise<void>(resolve => {
      engine.onResultsLogged = () => resolve();
    });

    engine.play();
    await logged;

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].credentials).toBe('include');
  });
});
