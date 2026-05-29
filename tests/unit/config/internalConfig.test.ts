import { describe, it, expect } from 'vitest';
import internalConfig from '../../../src/config/internalConfig.js';

describe('internalConfig', () => {
  describe('aimMeasurementScoring', () => {
    const { aimMeasurementScoring } = internalConfig;

    it('has scoring functions for all measurement types', () => {
      const expectedTypes = [
        'packetLoss',
        'latency',
        'loadedLatencyIncrease',
        'jitter',
        'download',
        'upload'
      ];
      for (const type of expectedTypes) {
        expect(typeof aimMeasurementScoring[type]).toBe('function');
      }
    });

    it('scores packetLoss correctly', () => {
      const score = aimMeasurementScoring.packetLoss;
      expect(score(0)).toBe(10); // 0% loss = best
      expect(score(0.01)).toBe(5); // at first threshold
      expect(score(0.5)).toBe(-20); // 50% loss = worst
    });

    it('scores latency correctly', () => {
      const score = aimMeasurementScoring.latency;
      expect(score(5)).toBe(20); // excellent latency
      expect(score(10)).toBe(10); // at first threshold
      expect(score(50)).toBe(0); // at third threshold
      expect(score(500)).toBe(-20); // very high latency
    });

    it('scores download bandwidth correctly', () => {
      const score = aimMeasurementScoring.download;
      expect(score(0)).toBe(0); // no bandwidth
      expect(score(1e6)).toBe(5); // 1 Mbps
      expect(score(100e6)).toBe(30); // 100 Mbps = max points
    });

    it('scores upload bandwidth correctly', () => {
      const score = aimMeasurementScoring.upload;
      expect(score(0)).toBe(0);
      expect(score(50e6)).toBe(20);
      expect(score(100e6)).toBe(30);
    });
  });

  describe('aimExperiencesDefs', () => {
    const { aimExperiencesDefs } = internalConfig;

    it('defines streaming, gaming, and rtc experiences', () => {
      expect(aimExperiencesDefs).toHaveProperty('streaming');
      expect(aimExperiencesDefs).toHaveProperty('gaming');
      expect(aimExperiencesDefs).toHaveProperty('rtc');
    });

    it('streaming depends on latency, packetLoss, download, and loadedLatencyIncrease', () => {
      expect(aimExperiencesDefs.streaming.input).toEqual([
        'latency',
        'packetLoss',
        'download',
        'loadedLatencyIncrease'
      ]);
    });

    it('has ascending point thresholds for each experience', () => {
      for (const [, def] of Object.entries(aimExperiencesDefs)) {
        for (let i = 1; i < def.pointThresholds.length; i++) {
          expect(def.pointThresholds[i]).toBeGreaterThan(
            def.pointThresholds[i - 1]
          );
        }
      }
    });
  });
});
