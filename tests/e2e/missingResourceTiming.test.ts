import { describe, it, expect, vi, afterEach } from 'vitest';
import SpeedTest from '../../src/index.ts';

describe('SpeedTest E2E without a resource timing entry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    'drops the sample and finishes the test',
    { timeout: 60_000, retry: 2 },
    async () => {
      // The browser has no entry for the first request, as when the host page
      // clears the buffer or the entry isn't recorded yet.
      vi.spyOn(performance, 'getEntriesByName').mockReturnValueOnce([]);

      const engine = new SpeedTest({
        autoStart: false,
        logAimApiUrl: null,
        logMeasurementApiUrl: null,
        measureDownloadLoadedLatency: false,
        measurements: [{ type: 'download', bytes: 1e5, count: 3 }]
      });
      const onError = vi.fn();
      engine.onError = onError;

      const results = await new Promise<typeof engine.results>(resolve => {
        engine.onFinish = resolve;
        engine.play();
      });

      expect(onError).not.toHaveBeenCalled();
      expect(results.isFinished).toBe(true);
      expect(results.getDownloadBandwidthPoints()).toHaveLength(2);
    }
  );
});
