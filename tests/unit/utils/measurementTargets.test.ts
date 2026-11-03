import { describe, it, expect } from 'vitest';
import SpeedTest from '../../../src';
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

  it.each([
    'speed.example.com',
    'ftp://speed.example.com',
    'https://speed.example.com/prefix',
    'https://speed.example.com/?a=1',
    'https://speed.example.com/#a'
  ])('rejects %s, which is not an http(s) origin', target => {
    expect(() =>
      resolveApiUrls([target], '/__down', 'https://fallback.example.com')
    ).toThrow(
      new TypeError(
        `Invalid measurementTargets entry "${target}": expected an origin such as https://speed.cloudflare.com`
      )
    );
  });
});

describe('measurementTargets config', () => {
  it('rejects an invalid target when the engine is created', () => {
    expect(
      () =>
        new SpeedTest({
          autoStart: false,
          measurementTargets: ['https://a.example.com', 'b.example.com']
        })
    ).toThrow(/Invalid measurementTargets entry "b\.example\.com"/);
  });
});
