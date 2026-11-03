import { afterEach, describe, it, expect, vi } from 'vitest';
import SpeedTest from '../../src/index.ts';

// Two URLs on the same origin, so requests can be told apart without a second host
const DOWNLOAD_URLS = [
  'https://speed.cloudflare.com/__down?host=a',
  'https://speed.cloudflare.com/__down?host=b'
];
const UPLOAD_URL = 'https://speed.cloudflare.com/__up';

describe('SpeedTest E2E with parallel bandwidth steps', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    'reports one data point per batch of concurrent requests',
    { timeout: 60_000, retry: 2 },
    async () => {
      const fetchSpy = vi.spyOn(window, 'fetch');
      const engine = new SpeedTest({
        autoStart: false,
        downloadApiUrl: DOWNLOAD_URLS,
        uploadApiUrl: UPLOAD_URL,
        logAimApiUrl: null,
        logMeasurementApiUrl: null,
        measureDownloadLoadedLatency: false,
        measureUploadLoadedLatency: false,
        measurements: [
          { type: 'download', bytes: 1e5, count: 2, parallel: 4 },
          { type: 'upload', bytes: 1e5, count: 2, parallel: 3 }
        ]
      });
      const onError = vi.fn();

      const results = await new Promise<typeof engine.results>(resolve => {
        engine.onFinish = resolve;
        engine.onError = error => {
          onError(error);
          resolve(engine.results);
        };
        engine.play();
      });

      expect(onError).not.toHaveBeenCalled();
      expect(results.isFinished).toBe(true);

      const downPoints = results.getDownloadBandwidthPoints();
      expect(downPoints).toHaveLength(2);
      downPoints.forEach(point => {
        expect(point.bytes).toBe(4e5);
        expect(point.bps).toBeGreaterThan(0);
        expect(point.duration).toBeGreaterThan(0);
      });

      const upPoints = results.getUploadBandwidthPoints();
      expect(upPoints).toHaveLength(2);
      upPoints.forEach(point => {
        expect(point.bytes).toBe(3e5);
        expect(point.bps).toBeGreaterThan(0);
      });

      const urls = fetchSpy.mock.calls.map(
        ([input]) => new URL(input as string)
      );
      const downUrls = urls.filter(url => url.pathname === '/__down');
      const upUrls = urls.filter(url => url.pathname === '/__up');
      expect(downUrls).toHaveLength(8);
      expect(upUrls).toHaveLength(6);

      // Each batch alternates between the two download URLs
      const hosts = downUrls.map(url => url.searchParams.get('host'));
      expect(hosts.filter(host => host === 'a')).toHaveLength(4);
      hosts.slice(1).forEach((host, i) => expect(host).not.toBe(hosts[i]));

      // Requests of a batch overlap: every one starts before any finishes
      const downEntries = downUrls
        .slice(0, 4)
        .map(
          url =>
            performance
              .getEntriesByName(url.href)
              .slice(-1)[0] as PerformanceResourceTiming
        );
      const firstEnd = Math.min(...downEntries.map(e => e.responseEnd));
      downEntries.forEach(entry =>
        expect(entry.startTime).toBeLessThan(firstEnd)
      );
    }
  );
});
