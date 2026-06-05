import { describe, it, expect } from 'vitest';
import Results from '../../../src/Results/index.ts';
import type { RawMeasurementEntry } from '../../../src/Results/index.ts';
import defaultConfig from '../../../src/config/defaultConfig.ts';
import internalConfig from '../../../src/config/internalConfig.ts';

type ResultsConfig = ConstructorParameters<typeof Results>[0];

function createResults(configOverrides = {}) {
  return new Results({
    ...defaultConfig,
    ...internalConfig,
    ...configOverrides
  } as ResultsConfig);
}

describe('Results', () => {
  describe('constructor and clear', () => {
    it('initializes raw results with measurement types from config', () => {
      const results = createResults();
      expect(results.raw).toHaveProperty('latency');
      expect(results.raw).toHaveProperty('download');
      expect(results.raw).toHaveProperty('upload');
      expect(results.raw).toHaveProperty('packetLoss');
      expect(results.raw).toHaveProperty('totalDurationMs');
    });

    it('marks all measurements as not started and not finished', () => {
      const results = createResults();
      for (const key of ['latency', 'download', 'upload', 'packetLoss']) {
        const entry = results.raw[key] as RawMeasurementEntry;
        expect(entry.started).toBe(false);
        expect(entry.finished).toBe(false);
      }
    });

    it('clears results back to initial state', () => {
      const results = createResults();
      (results.raw.latency as RawMeasurementEntry).started = true;
      (results.raw.latency as RawMeasurementEntry).finished = true;
      results.clear();
      expect((results.raw.latency as RawMeasurementEntry).started).toBe(false);
      expect((results.raw.latency as RawMeasurementEntry).finished).toBe(false);
    });
  });

  describe('isFinished', () => {
    it('returns false when no measurements have finished', () => {
      const results = createResults();
      expect(results.isFinished).toBe(false);
    });

    it('returns true when all measurements are finished', () => {
      const results = createResults({
        measurements: [{ type: 'latency', numPackets: 1 }]
      });
      (results.raw.latency as RawMeasurementEntry).finished = true;
      expect(results.isFinished).toBe(true);
    });

    it('returns false when only some measurements are finished', () => {
      const results = createResults({
        measurements: [
          { type: 'latency', numPackets: 1 },
          { type: 'download', bytes: 1e5, count: 1 }
        ]
      });
      (results.raw.latency as RawMeasurementEntry).finished = true;
      (results.raw.download as RawMeasurementEntry).finished = false;
      expect(results.isFinished).toBe(false);
    });
  });

  describe('getters return undefined when measurement not started', () => {
    it('getUnloadedLatency returns undefined', () => {
      const results = createResults();
      expect(results.getUnloadedLatency()).toBeUndefined();
    });

    it('getDownloadBandwidth returns undefined', () => {
      const results = createResults();
      expect(results.getDownloadBandwidth()).toBeUndefined();
    });

    it('getPacketLoss returns undefined', () => {
      const results = createResults();
      expect(results.getPacketLoss()).toBeUndefined();
    });

    it('getUnloadedLatencyPoints returns empty array', () => {
      const results = createResults();
      expect(results.getUnloadedLatencyPoints()).toEqual([]);
    });
  });

  describe('getters with populated data', () => {
    it('returns latency when measurement is started', () => {
      const results = createResults();
      const latency = results.raw.latency as RawMeasurementEntry;
      latency.started = true;
      latency.results = {
        timings: [{ ping: 10 }, { ping: 20 }, { ping: 30 }]
      };
      expect(results.getUnloadedLatency()).toBe(20); // median
    });

    it('returns jitter when measurement is started', () => {
      const results = createResults();
      const latency = results.raw.latency as RawMeasurementEntry;
      latency.started = true;
      latency.results = {
        timings: [{ ping: 10 }, { ping: 20 }, { ping: 30 }]
      };
      expect(results.getUnloadedJitter()).toBe(10);
    });

    it('returns bandwidth when measurement is started', () => {
      const results = createResults();
      const download = results.raw.download as RawMeasurementEntry;
      download.started = true;
      download.results = {
        100000: {
          timings: [
            {
              bps: 10e6,
              duration: 50,
              ping: 10,
              measTime: 100,
              serverTime: 5,
              transferSize: 100000
            }
          ]
        }
      };
      expect(results.getDownloadBandwidth()).toBe(10e6);
    });

    it('returns packet loss details with error when error exists', () => {
      const results = createResults();
      const packetLoss = results.raw.packetLoss as RawMeasurementEntry;
      packetLoss.started = true;
      packetLoss.error = 'Connection failed';
      const details = results.getPacketLossDetails();
      expect(details).toEqual({ error: 'Connection failed' });
    });
  });

  describe('getSummary', () => {
    it('returns empty object when nothing is started', () => {
      const results = createResults();
      const summary = results.getSummary();
      // Only totalDurationMs might be undefined, so it's excluded
      expect(Object.keys(summary)).toHaveLength(0);
    });

    it('includes only started measurements in summary', () => {
      const results = createResults();
      const latency = results.raw.latency as RawMeasurementEntry;
      latency.started = true;
      latency.results = {
        timings: [{ ping: 15 }]
      };

      const summary = results.getSummary();
      expect(summary).toHaveProperty('latency');
      expect(summary.latency).toBe(15);
      expect(summary).not.toHaveProperty('download');
      expect(summary).not.toHaveProperty('upload');
    });

    it('includes totalDurationMs when set', () => {
      const results = createResults();
      results.raw.totalDurationMs = 5000;
      const summary = results.getSummary();
      expect(summary.totalDurationMs).toBe(5000);
    });
  });

  describe('getScores', () => {
    it('returns scores based on current summary', () => {
      const results = createResults();
      const latency = results.raw.latency as RawMeasurementEntry;
      latency.started = true;
      latency.results = {
        timings: [{ ping: 5 }]
      };
      const download = results.raw.download as RawMeasurementEntry;
      download.started = true;
      download.results = {
        100000: {
          timings: [
            {
              bps: 100e6,
              duration: 50,
              ping: 5,
              measTime: 100,
              serverTime: 2,
              transferSize: 100000
            }
          ],
          sideLatency: [{ ping: 10 }, { ping: 15 }]
        }
      };

      const scores = results.getScores();
      expect(typeof scores).toBe('object');
    });
  });
});
