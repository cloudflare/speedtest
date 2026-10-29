import { describe, it, expect, vi, afterEach } from 'vitest';
import SpeedTest from '../../src/index.ts';

const DOWNLOAD_URL = /\/__down\?(.*&)?bytes=100000(&|$)/;

describe('SpeedTest E2E without a resource timing entry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    'drops the sample and finishes the test',
    { timeout: 60_000 },
    async () => {
      // Hide the first download's entry, as when the host page clears the buffer
      const getEntriesByName = performance.getEntriesByName.bind(performance);
      let hiddenStart: number | undefined;
      vi.spyOn(performance, 'getEntriesByName').mockImplementation(
        (name, type) => {
          const entries = getEntriesByName(name, type);
          if (!DOWNLOAD_URL.test(name)) return entries;
          hiddenStart ??= entries[0]?.startTime;
          return entries.filter(entry => entry.startTime !== hiddenStart);
        }
      );

      const engine = new SpeedTest({
        autoStart: false,
        logAimApiUrl: null,
        logMeasurementApiUrl: null,
        measureDownloadLoadedLatency: false,
        measurements: [{ type: 'download', bytes: 1e5, count: 3 }]
      });
      const onError = vi.fn();
      engine.onError = onError;
      const warn = vi.spyOn(console, 'warn');

      const results = await new Promise<typeof engine.results>(resolve => {
        engine.onFinish = resolve;
        engine.play();
      });

      expect(hiddenStart).toBeDefined();
      expect(warn).toHaveBeenCalledWith(
        'Discarding down sample without a resource timing entry',
        expect.objectContaining({ url: expect.stringMatching(DOWNLOAD_URL) })
      );
      expect(onError).not.toHaveBeenCalled();
      expect(results.isFinished).toBe(true);
      expect(results.getDownloadBandwidthPoints()).toHaveLength(2);
    }
  );
});
