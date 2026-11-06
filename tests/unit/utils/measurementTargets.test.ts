import { describe, it, expect } from 'vitest';
import SpeedTest from '../../../src';
import { resolveApiUrls } from '../../../src/utils/measurementTargets';

const DOWN = { path: '/__down', option: 'measurementDownloadPath' };
const UP = { path: '/__up', option: 'measurementUploadPath' };

describe('resolveApiUrls', () => {
  it('points each target origin at the API path', () => {
    expect(
      resolveApiUrls(
        ['https://a.example.com', 'https://b.example.com/'],
        DOWN,
        'https://fallback.example.com/__down'
      )
    ).toEqual(['https://a.example.com/__down', 'https://b.example.com/__down']);
  });

  it('uses a custom path, keeping its query string', () => {
    expect(
      resolveApiUrls(
        ['https://a.example.com'],
        { ...UP, path: '/speed/up?key=abc' },
        'https://fallback.example.com/__up'
      )
    ).toEqual(['https://a.example.com/speed/up?key=abc']);
  });

  it('keeps duplicate targets, so they get a larger share', () => {
    expect(
      resolveApiUrls(
        ['https://a.example.com', 'https://a.example.com'],
        UP,
        'https://fallback.example.com/__up'
      )
    ).toEqual(['https://a.example.com/__up', 'https://a.example.com/__up']);
  });

  it('falls back to the single API URL without targets', () => {
    expect(
      resolveApiUrls([], UP, 'https://fallback.example.com/custom-up')
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
      resolveApiUrls([target], DOWN, 'https://fallback.example.com')
    ).toThrow(
      new TypeError(
        `Invalid measurementTargets entry "${target}": expected an origin such as https://speed.cloudflare.com`
      )
    );
  });

  it.each([
    '__down',
    '',
    '//other.example.com/__down',
    '/\\other.example.com/__down',
    '/\t/other.example.com/__down'
  ])('rejects the path "%s", which does not start with a single /', path => {
    expect(() =>
      resolveApiUrls(
        ['https://a.example.com'],
        { ...DOWN, path },
        'https://fallback.example.com'
      )
    ).toThrow(
      new TypeError(
        `Invalid measurementDownloadPath "${path}": expected a path starting with /`
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

  it('rejects a host-switching path even without targets', () => {
    expect(
      () =>
        new SpeedTest({
          autoStart: false,
          measurementDownloadPath: '/\\other.example.com'
        })
    ).toThrow(/Invalid measurementDownloadPath/);
  });

  it('rejects an invalid path when the engine is created', () => {
    expect(
      () =>
        new SpeedTest({
          autoStart: false,
          measurementTargets: ['https://a.example.com'],
          measurementUploadPath: 'up'
        })
    ).toThrow(/Invalid measurementUploadPath "up"/);
  });

  it('falls back to the defaults for explicitly undefined options', () => {
    expect(
      () =>
        new SpeedTest({
          autoStart: false,
          measurementTargets: undefined,
          measurementDownloadPath: undefined,
          measurementUploadPath: undefined
        })
    ).not.toThrow();
  });

  it.each([
    [
      { measurementTargets: 'https://a.example.com' },
      'Invalid measurementTargets: expected an array of origins, got string'
    ],
    [
      { measurementTargets: [42] },
      'Invalid measurementTargets entry "42": expected an origin such as https://speed.cloudflare.com'
    ],
    [
      { measurementDownloadPath: 42 },
      'Invalid measurementDownloadPath: expected a path starting with /, got number'
    ]
  ])('rejects %o with a TypeError', (config, message) => {
    expect(
      () => new SpeedTest({ autoStart: false, ...(config as object) })
    ).toThrow(new TypeError(message));
  });
});
