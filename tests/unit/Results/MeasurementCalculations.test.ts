import { describe, it, expect } from 'vitest';
import MeasurementCalculations from '../../../src/Results/MeasurementCalculations.ts';
import type { MeasurementCalcConfig } from '../../../src/Results/MeasurementCalculations.ts';
import type {
  BandwidthTiming,
  PacketLossResults,
  ReachabilityResults
} from '../../../src/types.ts';

const defaultCalcConfig: MeasurementCalcConfig = {
  latencyPercentile: 0.5,
  bandwidthPercentile: 0.9,
  bandwidthMinRequestDuration: 10,
  loadedRequestMinDuration: 250,
  loadedLatencyMaxPoints: 20
};

function createCalc(configOverrides: Partial<MeasurementCalcConfig> = {}) {
  return new MeasurementCalculations({
    ...defaultCalcConfig,
    ...configOverrides
  });
}

describe('MeasurementCalculations', () => {
  describe('getLatencyPoints', () => {
    it('extracts ping values from timings', () => {
      const calc = createCalc();
      const result = calc.getLatencyPoints({
        timings: [{ ping: 10 }, { ping: 20 }, { ping: 30 }]
      });
      expect(result).toEqual([10, 20, 30]);
    });

    it('returns empty array for empty timings', () => {
      const calc = createCalc();
      expect(calc.getLatencyPoints({ timings: [] })).toEqual([]);
    });
  });

  describe('getLatency', () => {
    it('returns the median ping (p50) by default', () => {
      const calc = createCalc();
      const result = calc.getLatency({
        timings: [{ ping: 10 }, { ping: 20 }, { ping: 30 }]
      });
      expect(result).toBe(20);
    });

    it('uses configured percentile', () => {
      const calc = createCalc({ latencyPercentile: 0 });
      const result = calc.getLatency({
        timings: [{ ping: 10 }, { ping: 20 }, { ping: 30 }]
      });
      expect(result).toBe(10); // p0 = minimum
    });
  });

  describe('getJitter', () => {
    it('calculates average delta between consecutive pings', () => {
      const calc = createCalc();
      // deltas: |20-10|=10, |30-20|=10 => avg = 10
      const result = calc.getJitter({
        timings: [{ ping: 10 }, { ping: 20 }, { ping: 30 }]
      });
      expect(result).toBe(10);
    });

    it('returns null for a single ping', () => {
      const calc = createCalc();
      expect(calc.getJitter({ timings: [{ ping: 10 }] })).toBeNull();
    });

    it('returns null for empty timings', () => {
      const calc = createCalc();
      expect(calc.getJitter({ timings: [] })).toBeNull();
    });

    it('handles variable deltas', () => {
      const calc = createCalc();
      // deltas: |15-10|=5, |25-15|=10, |20-25|=5 => avg = 20/3
      const result = calc.getJitter({
        timings: [{ ping: 10 }, { ping: 15 }, { ping: 25 }, { ping: 20 }]
      });
      expect(result).toBeCloseTo(20 / 3);
    });
  });

  describe('getBandwidthPoints', () => {
    it('flattens bandwidth results from all byte sizes', () => {
      const calc = createCalc();
      const result = calc.getBandwidthPoints({
        100000: {
          timings: [
            {
              bps: 1e6,
              duration: 50,
              ping: 10,
              measTime: new Date(100),
              serverTime: 5,
              transferSize: 100000
            }
          ]
        },
        1000000: {
          timings: [
            {
              bps: 10e6,
              duration: 100,
              ping: 12,
              measTime: new Date(200),
              serverTime: 8,
              transferSize: 1000000
            }
          ]
        }
      });
      expect(result).toHaveLength(2);
      expect(result[0].bytes).toBe(100000);
      expect(result[1].bytes).toBe(1000000);
    });

    it('surfaces server-accepted upload bytes when present', () => {
      const calc = createCalc();
      const result = calc.getBandwidthPoints({
        5000000000: {
          timings: [
            {
              bps: 10e6,
              duration: 100,
              ping: 12,
              measTime: new Date(200),
              serverTime: 8,
              transferSize: 4000000000,
              uploadBytes: 4000000000
            }
          ]
        }
      });
      expect(result[0].bytes).toBe(5000000000);
      expect(result[0].uploadBytes).toBe(4000000000);
    });
  });

  describe('getBandwidth', () => {
    it('filters by minimum request duration and returns p90', () => {
      const calc = createCalc({
        bandwidthMinRequestDuration: 10,
        bandwidthPercentile: 0.9
      });

      const result = calc.getBandwidth({
        100000: {
          timings: [
            {
              bps: 1e6,
              duration: 5,
              ping: 10,
              measTime: new Date(100),
              serverTime: 5,
              transferSize: 100000
            }, // filtered out (duration < 10)
            {
              bps: 5e6,
              duration: 50,
              ping: 10,
              measTime: new Date(100),
              serverTime: 5,
              transferSize: 100000
            },
            {
              bps: 10e6,
              duration: 100,
              ping: 10,
              measTime: new Date(100),
              serverTime: 5,
              transferSize: 100000
            }
          ]
        }
      });

      // Only bps values with duration >= 10: [5e6, 10e6]
      // p90 of [5e6, 10e6]: idx = 1 * 0.9 = 0.9, edges = [5e6, 10e6]
      // result = 5e6 + (10e6 - 5e6) * 0.9 = 9.5e6
      expect(result).toBeCloseTo(9.5e6);
    });
  });

  describe('getPacketLoss', () => {
    it('returns the packetLoss value directly', () => {
      const calc = createCalc();
      expect(
        calc.getPacketLoss({
          packetLoss: 0.02,
          totalMessages: 100,
          numMessagesSent: 100,
          lostMessages: [5, 10]
        } as PacketLossResults)
      ).toBe(0.02);
    });
  });

  describe('getPacketLossDetails', () => {
    it('returns the full results object', () => {
      const calc = createCalc();
      const details: PacketLossResults = {
        packetLoss: 0.02,
        totalMessages: 100,
        numMessagesSent: 100,
        lostMessages: [5, 10]
      };
      expect(calc.getPacketLossDetails(details)).toBe(details);
    });
  });

  describe('getLoadedLatency', () => {
    it('extracts side latency from loaded results', () => {
      const calc = createCalc({
        loadedRequestMinDuration: 100,
        loadedLatencyMaxPoints: 20,
        latencyPercentile: 0.5
      });

      const result = calc.getLoadedLatency({
        100000: {
          timings: [{ duration: 200 } as BandwidthTiming], // >= minDuration
          sideLatency: [{ ping: 50 }, { ping: 60 }]
        }
      });

      expect(result).toBe(55); // median of [50, 60]
    });

    it('filters out file sizes that did not saturate the connection', () => {
      const calc = createCalc({
        loadedRequestMinDuration: 250,
        loadedLatencyMaxPoints: 20,
        latencyPercentile: 0.5
      });

      const result = calc.getLoadedLatency({
        100000: {
          timings: [{ duration: 50 } as BandwidthTiming], // < 250, filtered out
          sideLatency: [{ ping: 999 }]
        },
        1000000: {
          timings: [{ duration: 300 } as BandwidthTiming], // >= 250, kept
          sideLatency: [{ ping: 40 }, { ping: 60 }]
        }
      });

      expect(result).toBe(50); // median of [40, 60] from the 1M size only
    });
  });

  describe('getReachability', () => {
    it('returns true for reachable results', () => {
      const calc = createCalc();
      expect(
        calc.getReachability({ reachable: true } as ReachabilityResults)
      ).toBe(true);
    });

    it('returns false for unreachable results', () => {
      const calc = createCalc();
      expect(
        calc.getReachability({ reachable: false } as ReachabilityResults)
      ).toBe(false);
    });
  });
});
