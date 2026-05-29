import { describe, it, expect } from 'vitest';
import scaleThreshold from '../../../src/utils/scaleThreshold.js';

describe('scaleThreshold', () => {
  it('returns range[0] for values below the first threshold', () => {
    const scale = scaleThreshold([10, 20, 30], ['a', 'b', 'c', 'd']);
    expect(scale(5)).toBe('a');
  });

  it('returns the correct range value for values at thresholds', () => {
    const scale = scaleThreshold([10, 20, 30], ['a', 'b', 'c', 'd']);
    // value >= 10, so moves past first threshold
    expect(scale(10)).toBe('b');
    expect(scale(20)).toBe('c');
    expect(scale(30)).toBe('d');
  });

  it('returns the last range value for values above all thresholds', () => {
    const scale = scaleThreshold([10, 20], ['low', 'mid', 'high']);
    expect(scale(100)).toBe('high');
  });

  it('returns range[0] for NaN', () => {
    const scale = scaleThreshold([10, 20], ['a', 'b', 'c']);
    expect(scale(NaN)).toBe('a');
  });

  it('returns range[0] for null', () => {
    const scale = scaleThreshold([10, 20], ['a', 'b', 'c']);
    expect(scale(null)).toBe('a');
  });

  it('returns range[0] for undefined', () => {
    const scale = scaleThreshold([10, 20], ['a', 'b', 'c']);
    expect(scale(undefined)).toBe('a');
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
    const scale = scaleThreshold([50], ['below', 'above']);
    expect(scale(49)).toBe('below');
    expect(scale(50)).toBe('above');
    expect(scale(51)).toBe('above');
  });

  it('handles empty domain (always returns range[0])', () => {
    const scale = scaleThreshold([], ['only']);
    expect(scale(0)).toBe('only');
    expect(scale(100)).toBe('only');
  });
});
