import { describe, it, expect, vi, afterEach } from 'vitest';
import { withAuthorizationHeader } from '../../../src/utils/authorization.ts';

/** The helper resolves relative URLs against the page origin, like the engines do. */
const stubOrigin = (origin: string): void => {
  vi.stubGlobal('window', { location: { origin } });
};

const TOKEN = 'eyJhbGciOiJFUzI1NiJ9.payload.signature';

/** Header lookup that works whichever HeadersInit shape came back. */
const authOf = (init: RequestInit): string | null =>
  new Headers(init.headers).get('authorization');

describe('withAuthorizationHeader', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('attaches the token as a bearer Authorization header', () => {
    const init = withAuthorizationHeader(
      {},
      TOKEN,
      'https://speed.example.com/__down'
    );

    expect(authOf(init)).toBe(`Bearer ${TOKEN}`);
  });

  it('never puts the token in the URL', () => {
    // The whole point of the header: no caller may end up logging the token.
    const apiUrl = 'https://speed.example.com/__down?bytes=100000';
    const init = withAuthorizationHeader({}, TOKEN, apiUrl);

    expect(JSON.stringify(init)).not.toContain(TOKEN.split('.')[1]);
    expect(apiUrl).not.toContain(TOKEN);
  });

  it('preserves the rest of the request init', () => {
    const body = 'payload';
    const init = withAuthorizationHeader(
      { method: 'POST', body, credentials: 'include' },
      TOKEN,
      'https://speed.example.com/__up'
    );

    expect(init.method).toBe('POST');
    expect(init.body).toBe(body);
    expect(init.credentials).toBe('include');
  });

  it('preserves headers the caller already set', () => {
    const init = withAuthorizationHeader(
      { headers: { 'content-type': 'text/plain' } },
      TOKEN,
      'https://speed.example.com/__log'
    );

    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('text/plain');
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('does not mutate the init it was given', () => {
    const original: RequestInit = { method: 'POST' };
    withAuthorizationHeader(original, TOKEN, 'https://speed.example.com/__up');

    expect(original.headers).toBeUndefined();
  });

  it('returns the init untouched when there is no token', () => {
    const original: RequestInit = { method: 'POST' };

    expect(
      withAuthorizationHeader(original, null, 'https://speed.example.com/__up')
    ).toBe(original);
    expect(
      withAuthorizationHeader(original, '', 'https://speed.example.com/__up')
    ).toBe(original);
  });

  it('resolves relative URLs against the page origin', () => {
    stubOrigin('https://speed.example.com');

    expect(authOf(withAuthorizationHeader({}, TOKEN, '/__down'))).toBe(
      `Bearer ${TOKEN}`
    );
  });

  it('never attaches the token over plain HTTP', () => {
    expect(
      authOf(
        withAuthorizationHeader({}, TOKEN, 'http://speed.example.com/__down')
      )
    ).toBeNull();
  });

  it('never attaches the token to a relative URL on an HTTP page', () => {
    stubOrigin('http://speed.example.com');

    expect(authOf(withAuthorizationHeader({}, TOKEN, '/__down'))).toBeNull();
  });

  it('attaches to absolute URLs without a DOM', () => {
    // Every default API URL is absolute, so constructing an engine with a token
    // must not require a DOM.
    expect(typeof window).toBe('undefined');

    expect(
      authOf(
        withAuthorizationHeader({}, TOKEN, 'https://speed.example.com/__down')
      )
    ).toBe(`Bearer ${TOKEN}`);
  });

  it('does not throw on a URL it cannot resolve', () => {
    expect(typeof window).toBe('undefined');

    expect(() => withAuthorizationHeader({}, TOKEN, '/__down')).not.toThrow();
    expect(authOf(withAuthorizationHeader({}, TOKEN, '/__down'))).toBeNull();
    expect(authOf(withAuthorizationHeader({}, TOKEN, 'not a url'))).toBeNull();
  });

  it('returns the init untouched when there is no target URL', () => {
    const original: RequestInit = {};

    expect(withAuthorizationHeader(original, TOKEN, null)).toBe(original);
    expect(withAuthorizationHeader(original, TOKEN, undefined)).toBe(original);
  });
});
