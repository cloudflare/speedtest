import { describe, it, expect } from 'vitest';
import defaultConfig from '../../../src/config/defaultConfig.ts';

describe('defaultConfig', () => {
  it('has autoStart enabled by default', () => {
    expect(defaultConfig.autoStart).toBe(true);
  });

  it('has correct API URLs', () => {
    expect(defaultConfig.downloadApiUrl).toBe(
      'https://speed.cloudflare.com/__down'
    );
    expect(defaultConfig.uploadApiUrl).toBe(
      'https://speed.cloudflare.com/__up'
    );
    expect(defaultConfig.turnServerCredsApiUrl).toBe(
      'https://speed.cloudflare.com/turn-creds'
    );
  });

  it('has a measurements array with expected types', () => {
    expect(Array.isArray(defaultConfig.measurements)).toBe(true);
    expect(defaultConfig.measurements.length).toBeGreaterThan(0);

    const types = new Set(defaultConfig.measurements.map(m => m.type));
    expect(types).toContain('latency');
    expect(types).toContain('download');
    expect(types).toContain('upload');
    expect(types).toContain('packetLoss');
  });

  it('has valid percentile values between 0 and 1', () => {
    expect(defaultConfig.latencyPercentile).toBeGreaterThanOrEqual(0);
    expect(defaultConfig.latencyPercentile).toBeLessThanOrEqual(1);
    expect(defaultConfig.bandwidthPercentile).toBeGreaterThanOrEqual(0);
    expect(defaultConfig.bandwidthPercentile).toBeLessThanOrEqual(1);
  });

  it('has positive duration thresholds', () => {
    expect(defaultConfig.bandwidthFinishRequestDuration).toBeGreaterThan(0);
    expect(defaultConfig.bandwidthMinRequestDuration).toBeGreaterThan(0);
    expect(defaultConfig.loadedRequestMinDuration).toBeGreaterThan(0);
    expect(defaultConfig.loadedLatencyMaxPoints).toBeGreaterThan(0);
  });

  it('has loaded latency measurement flags', () => {
    expect(defaultConfig.measureDownloadLoadedLatency).toBe(true);
    expect(defaultConfig.measureUploadLoadedLatency).toBe(true);
  });

  it('has credentials disabled by default', () => {
    expect(defaultConfig.includeCredentials).toBe(false);
  });

  it('has null values for optional TURN server credentials', () => {
    expect(defaultConfig.turnServerUser).toBeNull();
    expect(defaultConfig.turnServerPass).toBeNull();
  });
});
