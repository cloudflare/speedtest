import { describe, it, expect } from 'vitest';
import { resolveApiUrls } from '../../../src/utils/measurementTargets';

describe('resolveApiUrls', () => {
  it('points each target origin at the API path', () => {
    expect(
      resolveApiUrls(
        ['https://a.example.com', 'https://b.example.com/'],
        '/__down',
        'https://fallback.example.com/__down'
      )
    ).toEqual(['https://a.example.com/__down', 'https://b.example.com/__down']);
  });

  it('keeps duplicate targets, so they get a larger share', () => {
    expect(
      resolveApiUrls(
        ['https://a.example.com', 'https://a.example.com'],
        '/__up',
        'https://fallback.example.com/__up'
      )
    ).toEqual(['https://a.example.com/__up', 'https://a.example.com/__up']);
  });

  it('falls back to the single API URL without targets', () => {
    expect(
      resolveApiUrls([], '/__up', 'https://fallback.example.com/custom-up')
    ).toEqual(['https://fallback.example.com/custom-up']);
  });
});
