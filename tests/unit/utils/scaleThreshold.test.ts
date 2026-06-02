import { describe, it, expect } from 'vitest';
import scaleThreshold from '../../../src/utils/scaleThreshold.ts';

describe('scaleThreshold', () => {
  it('returns range[0] for values below the first threshold', () => {
    const scale = scaleThreshold([10, 20, 30], [1, 2, 3, 4]);
    expect(scale(5)).toBe(1);
  });

  it('returns the correct range value for values at thresholds', () => {
    const scale = scaleThreshold([10, 20, 30], [1, 2, 3, 4]);
    // value >= 10, so moves past first threshold
    expect(scale(10)).toBe(2);
    expect(scale(20)).toBe(3);
    expect(scale(30)).toBe(4);
  });

  it('returns the last range value for values above all thresholds', () => {
    const scale = scaleThreshold([10, 20], [0, 1, 2]);
    expect(scale(100)).toBe(2);
  });

  it('returns range[0] for NaN', () => {
    const scale = scaleThreshold([10, 20], [0, 1, 2]);
    expect(scale(NaN)).toBe(0);
  });

  it('returns range[0] for null', () => {
    const scale = scaleThreshold([10, 20], [0, 1, 2]);
    expect(scale(null as unknown as number)).toBe(0);
  });

  it('returns range[0] for undefined', () => {
    const scale = scaleThreshold([10, 20], [0, 1, 2]);
    expect(scale(undefined as unknown as number)).toBe(0);
  });

  it('works with numeric ranges', () => {
    const scale = scaleThreshold([0.01, 0.05, 0.25, 0.5], [10, 5, 0, -10, -20]);
    expect(scale(0)).toBe(10); // below all thresholds
    expect(scale(0.01)).toBe(5); // at first threshold
    expect(scale(0.03)).toBe(5); // between first and second
    expect(scale(0.5)).toBe(-20); // at last threshold
    expect(scale(1)).toBe(-20); // above all thresholds
  });

  it('handles a single threshold', () => {
    const scale = scaleThreshold([50], [0, 1]);
    expect(scale(49)).toBe(0);
    expect(scale(50)).toBe(1);
    expect(scale(51)).toBe(1);
  });

  it('handles empty domain (always returns range[0])', () => {
    const scale = scaleThreshold([], [99]);
    expect(scale(0)).toBe(99);
    expect(scale(100)).toBe(99);
  });
});
