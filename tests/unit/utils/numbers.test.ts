import { describe, it, expect } from 'vitest';
import { sum, avg, percentile } from '../../../src/utils/numbers.js';

describe('sum', () => {
  it('sums an array of numbers', () => {
    expect(sum([1, 2, 3])).toBe(6);
  });

  it('returns 0 for an empty array', () => {
    expect(sum([])).toBe(0);
  });

  it('handles a single element', () => {
    expect(sum([42])).toBe(42);
  });

  it('handles negative numbers', () => {
    expect(sum([-1, 1, -2, 2])).toBe(0);
  });

  it('handles floating point numbers', () => {
    expect(sum([0.1, 0.2])).toBeCloseTo(0.3);
  });
});

describe('avg', () => {
  it('calculates the average', () => {
    expect(avg([2, 4, 6])).toBe(4);
  });

  it('returns NaN for an empty array', () => {
    expect(avg([])).toBeNaN();
  });

  it('returns the value for a single element', () => {
    expect(avg([10])).toBe(10);
  });

  it('handles floating point results', () => {
    expect(avg([1, 2])).toBe(1.5);
  });
});

describe('percentile', () => {
  it('returns 0 for an empty array', () => {
    expect(percentile([])).toBe(0);
  });

  it('returns the single value for a one-element array', () => {
    expect(percentile([42])).toBe(42);
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 1)).toBe(42);
  });

  it('calculates the median (default p50)', () => {
    expect(percentile([1, 2, 3, 4, 5])).toBe(3);
  });

  it('calculates p0 (minimum)', () => {
    expect(percentile([10, 20, 30], 0)).toBe(10);
  });

  it('calculates p100 (maximum)', () => {
    expect(percentile([10, 20, 30], 1)).toBe(30);
  });

  it('calculates p90', () => {
    // For [1, 2, 3, 4, 5], idx = 4 * 0.9 = 3.6
    // floor=3 (val=4), ceil=4 (val=5), rem=0.6
    // result = 4 + (5 - 4) * 0.6 = 4.6
    expect(percentile([1, 2, 3, 4, 5], 0.9)).toBeCloseTo(4.6);
  });

  it('sorts the input without mutating the original array', () => {
    const input = [5, 1, 3, 2, 4];
    const copy = [...input];
    percentile(input, 0.5);
    expect(input).toEqual(copy);
  });

  it('handles unsorted input', () => {
    expect(percentile([5, 1, 3], 0.5)).toBe(3);
  });

  it('handles duplicate values', () => {
    expect(percentile([5, 5, 5, 5], 0.5)).toBe(5);
  });
});
