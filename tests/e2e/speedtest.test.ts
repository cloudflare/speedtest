import { describe, it, expect } from 'vitest';
import SpeedTest from '../../src/index.ts';

const VALID_CLASSIFICATIONS = ['bad', 'poor', 'average', 'good', 'great'];

describe('SpeedTest E2E', () => {
  it('runs a realistic speed test and produces valid results', {
    timeout: 120_000,
    retry: 2
  }, async () => {
    const engine = new SpeedTest({
      autoStart: false,
      logAimApiUrl: null,
      logMeasurementApiUrl: null,
      measurements: [
        // Phase 1: Initial estimation
        { type: 'latency', numPackets: 1 },
        { type: 'download', bytes: 1e5, count: 1, bypassMinDuration: true },
        // Phase 2: Latency measurement
        { type: 'latency', numPackets: 10 },
        // Phase 3: Progressive downloads
        { type: 'download', bytes: 1e5, count: 4 },
        { type: 'download', bytes: 1e6, count: 3 },
        { type: 'download', bytes: 1e7, count: 2 },
        // Phase 4: Progressive uploads
        { type: 'upload', bytes: 1e5, count: 4 },
        { type: 'upload', bytes: 1e6, count: 3 },
        { type: 'upload', bytes: 1e7, count: 2 }
      ],
      measureDownloadLoadedLatency: true,
      measureUploadLoadedLatency: true,
      // Lower the min duration threshold so fast CI connections still
      // produce loaded latency data (default 250ms filters out fast downloads)
      loadedRequestMinDuration: 10
    });

    // Run the speed test and wait for completion
    const resultsObj = await new Promise<typeof engine.results>(
      (resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Speed test timed out after 90 seconds'));
        }, 90_000);

        engine.onFinish = results => {
          clearTimeout(timeout);
          resolve(results);
        };

        engine.onError = error => {
          clearTimeout(timeout);
          reject(new Error(`Speed test error: ${error}`));
        };

        engine.play();
      }
    );

    // ── Engine state ──────────────────────────────────────────────
    expect(resultsObj.isFinished).toBe(true);

    // ── Summary values with reasonable ranges ─────────────────────
    const summary = resultsObj.getSummary();

    // Latency: should be between 0 and 1000ms from any CI runner
    expect(summary.latency).toBeGreaterThan(0);
    expect(summary.latency).toBeLessThan(1000);

    // Jitter: should be between 0 and 500ms
    expect(summary.jitter).toBeGreaterThanOrEqual(0);
    expect(summary.jitter).toBeLessThan(500);

    // Download bandwidth: at least 1 Kbps (any CI runner can do this)
    expect(summary.download).toBeGreaterThan(1000);

    // Upload bandwidth: at least 1 Kbps
    expect(summary.upload).toBeGreaterThan(1000);

    // Loaded latency (download): may be absent on very fast connections
    // where the parallel latency engine doesn't collect data before
    // downloads finish. When present, should be reasonable.
    if (summary.downLoadedLatency !== undefined) {
      expect(summary.downLoadedLatency).toBeGreaterThanOrEqual(0);
      expect(summary.downLoadedLatency).toBeLessThan(5000);
    }
    if (summary.downLoadedJitter !== undefined) {
      expect(summary.downLoadedJitter).toBeGreaterThanOrEqual(0);
      expect(summary.downLoadedJitter).toBeLessThan(2000);
    }

    // Loaded latency (upload): same caveat as download
    if (summary.upLoadedLatency !== undefined) {
      expect(summary.upLoadedLatency).toBeGreaterThanOrEqual(0);
      expect(summary.upLoadedLatency).toBeLessThan(5000);
    }
    if (summary.upLoadedJitter !== undefined) {
      expect(summary.upLoadedJitter).toBeGreaterThanOrEqual(0);
      expect(summary.upLoadedJitter).toBeLessThan(2000);
    }

    // Total duration: between 1 second and 2 minutes
    expect(summary.totalDurationMs).toBeGreaterThan(1000);
    expect(summary.totalDurationMs).toBeLessThan(120_000);

    // ── Raw data points ───────────────────────────────────────────

    // Download bandwidth points
    const dlPoints = resultsObj.getDownloadBandwidthPoints();
    expect(dlPoints.length).toBeGreaterThan(0);
    for (const p of dlPoints) {
      expect(p.bytes).toBeGreaterThan(0);
      expect(p.bps).toBeGreaterThan(0);
      expect(p.duration).toBeGreaterThan(0);
    }

    // Upload bandwidth points
    const ulPoints = resultsObj.getUploadBandwidthPoints();
    expect(ulPoints.length).toBeGreaterThan(0);
    for (const p of ulPoints) {
      expect(p.bytes).toBeGreaterThan(0);
      expect(p.bps).toBeGreaterThan(0);
      expect(p.duration).toBeGreaterThan(0);
    }

    // Unloaded latency points
    const latencyPoints = resultsObj.getUnloadedLatencyPoints();
    expect(latencyPoints.length).toBeGreaterThan(0);
    for (const p of latencyPoints) {
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1000);
    }

    // Loaded latency points (download) — may be empty on fast connections
    const dlLoadedPoints = resultsObj.getDownLoadedLatencyPoints();
    for (const p of dlLoadedPoints) {
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(5000);
    }

    // ── AIM Scores ────────────────────────────────────────────────
    const scores = resultsObj.getScores();

    for (const experience of ['streaming', 'gaming', 'rtc']) {
      expect(scores[experience]).toBeDefined();
      expect(scores[experience].points).toBeGreaterThanOrEqual(0);
      expect(scores[experience].classificationIdx).toBeGreaterThanOrEqual(0);
      expect(scores[experience].classificationIdx).toBeLessThanOrEqual(4);
      expect(VALID_CLASSIFICATIONS).toContain(
        scores[experience].classificationName
      );
    }
  });
});
