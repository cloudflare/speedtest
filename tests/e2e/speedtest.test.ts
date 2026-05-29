import { describe, it, expect } from 'vitest';
import SpeedTest from '../../src/index.js';

describe('SpeedTest E2E', () => {
  it('runs a minimal speed test and produces valid results', {
    timeout: 60_000
  }, async () => {
    const engine = new SpeedTest({
      autoStart: false,
      logAimApiUrl: null,
      logMeasurementApiUrl: null,
      measurements: [
        { type: 'latency', numPackets: 3 },
        { type: 'download', bytes: 1e5, count: 1, bypassMinDuration: true }
      ]
    });

    const results = await new Promise<ReturnType<typeof engine.results.getSummary>>(
      (resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Speed test timed out after 30 seconds'));
        }, 30_000);

        engine.onFinish = results => {
          clearTimeout(timeout);
          resolve(results.getSummary());
        };

        engine.onError = error => {
          clearTimeout(timeout);
          reject(new Error(`Speed test error: ${error}`));
        };

        engine.play();
      }
    );

    // Verify latency results
    expect(results.latency).toBeDefined();
    expect(typeof results.latency).toBe('number');
    expect(results.latency).toBeGreaterThan(0);

    // Verify jitter results
    expect(results.jitter).toBeDefined();
    expect(typeof results.jitter).toBe('number');
    expect(results.jitter).toBeGreaterThanOrEqual(0);

    // Verify download results
    expect(results.download).toBeDefined();
    expect(typeof results.download).toBe('number');
    expect(results.download).toBeGreaterThan(0);

    // Verify total duration
    expect(results.totalDurationMs).toBeDefined();
    expect(results.totalDurationMs).toBeGreaterThan(0);
  });
});
