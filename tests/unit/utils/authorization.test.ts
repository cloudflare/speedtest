import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  AUTHORIZATION_TOKEN_PARAM,
  withAuthorizationToken
} from '../../../src/utils/authorization.ts';

/** The helper resolves relative URLs against the page origin, like the engines do. */
const stubOrigin = (origin: string): void => {
  vi.stubGlobal('window', { location: { origin } });
};

const TOKEN = 'eyJhbGciOiJFUzI1NiJ9.payload.signature';

describe('withAuthorizationToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('appends the token as a query-string param', () => {
    stubOrigin('https://speed.example.com');

    const url = withAuthorizationToken(
      'https://speed.example.com/__down',
      TOKEN
    );

    expect(new URL(url).searchParams.get(AUTHORIZATION_TOKEN_PARAM)).toBe(
      TOKEN
    );
  });

  it('uses `token` as the param name', () => {
    stubOrigin('https://speed.example.com');

    expect(
      withAuthorizationToken('https://speed.example.com/__up', 'abc')
    ).toBe('https://speed.example.com/__up?token=abc');
  });

  it('preserves query params already present on the URL', () => {
    stubOrigin('https://speed.example.com');

    const url = new URL(
      withAuthorizationToken(
        'https://speed.example.com/__down?foo=bar&baz=1',
        TOKEN
      )
    );

    expect(url.searchParams.get('foo')).toBe('bar');
    expect(url.searchParams.get('baz')).toBe('1');
    expect(url.searchParams.get(AUTHORIZATION_TOKEN_PARAM)).toBe(TOKEN);
  });

  it('url-encodes tokens containing reserved characters', () => {
    stubOrigin('https://speed.example.com');

    const url = withAuthorizationToken(
      'https://speed.example.com/__down',
      'a+b/c=d&e'
    );

    expect(url).not.toContain('a+b/c=d&e');
    expect(new URL(url).searchParams.get(AUTHORIZATION_TOKEN_PARAM)).toBe(
      'a+b/c=d&e'
    );
  });

  it('resolves relative URLs against the page origin', () => {
    stubOrigin('https://speed.example.com');

    expect(withAuthorizationToken('/__down', TOKEN)).toBe(
      `https://speed.example.com/__down?token=${encodeURIComponent(TOKEN)}`
    );
  });

  it('returns the URL untouched when there is no token', () => {
    stubOrigin('https://speed.example.com');

    expect(
      withAuthorizationToken('https://speed.example.com/__down', null)
    ).toBe('https://speed.example.com/__down');
    expect(withAuthorizationToken('https://speed.example.com/__down', '')).toBe(
      'https://speed.example.com/__down'
    );
  });

  it('never attaches the token over plain HTTP', () => {
    stubOrigin('https://speed.example.com');

    expect(
      withAuthorizationToken('http://speed.example.com/__down', TOKEN)
    ).toBe('http://speed.example.com/__down');
  });

  it('never attaches the token to a relative URL on an HTTP page', () => {
    stubOrigin('http://speed.example.com');

    expect(withAuthorizationToken('/__down', TOKEN)).toBe('/__down');
  });

  it('does not touch `window` when there is no token', () => {
    // Guards SSR/`autoStart: false` construction: the default config must not
    // require a DOM just to build the engine.
    expect(() => withAuthorizationToken('/__down', null)).not.toThrow();
  });
});
