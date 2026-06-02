import { describe, it, expect } from 'vitest';
import ScoresCalculations from '../../../src/Results/ScoresCalculations.ts';
import internalConfig from '../../../src/config/internalConfig.ts';

function createScoresCalc() {
  return new ScoresCalculations(internalConfig);
}

describe('ScoresCalculations', () => {
  describe('getScores', () => {
    it('returns empty object when no measurements available', () => {
      const calc = createScoresCalc();
      const scores = calc.getScores({});
      expect(scores).toEqual({});
    });

    it('calculates streaming score for excellent connection', () => {
      const calc = createScoresCalc();
      const scores = calc.getScores({
        latency: 5, // 20 points
        packetLoss: 0, // 10 points
        download: 100e6, // 30 points
        downLoadedLatency: 15, // loadedLatencyIncrease = 15 - 5 = 10 => 10 points
        upLoadedLatency: 10
      });

      expect(scores.streaming).toBeDefined();
      expect(scores.streaming.classificationName).toBe('great');
      expect(scores.streaming.classificationIdx).toBe(4);
      expect(scores.streaming.points).toBeGreaterThan(0);
    });

    it('calculates gaming score for poor connection', () => {
      const calc = createScoresCalc();
      const scores = calc.getScores({
        latency: 200, // -10 points
        packetLoss: 0.3, // -10 points
        downLoadedLatency: 500, // loadedLatencyIncrease = 500 - 200 = 300 => -10 points
        upLoadedLatency: 400
      });

      expect(scores.gaming).toBeDefined();
      // All negative points => clamped to 0
      expect(scores.gaming.points).toBe(0);
      expect(scores.gaming.classificationName).toBe('bad');
      expect(scores.gaming.classificationIdx).toBe(0);
    });

    it('skips experiences when required inputs are missing', () => {
      const calc = createScoresCalc();
      // Only provide latency — not enough for any experience
      const scores = calc.getScores({
        latency: 10
      });

      // packetLoss defaults to 0, but loadedLatencyIncrease needs
      // both latency and loaded latency
      expect(scores.streaming).toBeUndefined();
      expect(scores.gaming).toBeUndefined();
      expect(scores.rtc).toBeUndefined();
    });

    it('calculates all three experience scores', () => {
      const calc = createScoresCalc();
      const scores = calc.getScores({
        latency: 20,
        jitter: 10,
        packetLoss: 0.01,
        download: 50e6,
        upload: 10e6,
        downLoadedLatency: 50,
        upLoadedLatency: 40
      });

      expect(scores.streaming).toBeDefined();
      expect(scores.gaming).toBeDefined();
      expect(scores.rtc).toBeDefined();

      // Each should have the required properties
      for (const experience of ['streaming', 'gaming', 'rtc']) {
        expect(scores[experience]).toHaveProperty('points');
        expect(scores[experience]).toHaveProperty('classificationIdx');
        expect(scores[experience]).toHaveProperty('classificationName');
        expect(scores[experience].classificationIdx).toBeGreaterThanOrEqual(0);
        expect(scores[experience].classificationIdx).toBeLessThanOrEqual(4);
        expect(
          ['bad', 'poor', 'average', 'good', 'great'].includes(
            scores[experience].classificationName
          )
        ).toBe(true);
      }
    });

    it('uses default points for packetLoss when not provided', () => {
      const calc = createScoresCalc();
      // packetLoss defaults to 0 points when missing
      const scores = calc.getScores({
        latency: 5,
        download: 100e6,
        downLoadedLatency: 10,
        upLoadedLatency: 8
      });

      // Streaming should work: latency (20) + packetLoss (0 default)
      // + download (30) + loadedLatencyIncrease (10-5=5 => 20 points)
      expect(scores.streaming).toBeDefined();
    });
  });
});
