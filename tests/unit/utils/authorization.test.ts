import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  withAuthorizationHeader,
  type AuthorizationOptions
} from '../../../src/utils/authorization.ts';

/** The helper resolves relative URLs against the page origin, like the engines do. */
const stubOrigin = (origin: string): void => {
  vi.stubGlobal('window', { location: { origin } });
};

const TOKEN = 'eyJhbGciOiJFUzI1NiJ9.payload.signature';

const secure: AuthorizationOptions = { token: TOKEN, allowInsecure: false };
const insecureAllowed: AuthorizationOptions = {
  token: TOKEN,
  allowInsecure: true
};

/** Header lookup that works whichever HeadersInit shape came back. */
const authOf = (init: RequestInit): string | null =>
  new Headers(init.headers).get('authorization');

describe('withAuthorizationHeader', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('attaches the token as a bearer Authorization header', () => {
    const init = withAuthorizationHeader(
      {},
      secure,
      'https://speed.example.com/__down'
    );

    expect(authOf(init)).toBe(`Bearer ${TOKEN}`);
  });

  it('never puts the token in the URL', () => {
    // The whole point of the header: no caller may end up logging the token.
    const apiUrl = 'https://speed.example.com/__down?bytes=100000';
    const init = withAuthorizationHeader({}, secure, apiUrl);

    expect(JSON.stringify(init)).not.toContain(TOKEN.split('.')[1]);
    expect(apiUrl).not.toContain(TOKEN);
  });

  it('preserves the rest of the request init', () => {
    const body = 'payload';
    const init = withAuthorizationHeader(
      { method: 'POST', body, credentials: 'include' },
      secure,
      'https://speed.example.com/__up'
    );

    expect(init.method).toBe('POST');
    expect(init.body).toBe(body);
    expect(init.credentials).toBe('include');
  });

  it('preserves headers the caller already set', () => {
    const init = withAuthorizationHeader(
      { headers: { 'content-type': 'text/plain' } },
      secure,
      'https://speed.example.com/__log'
    );

    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('text/plain');
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('does not mutate the init it was given', () => {
    const original: RequestInit = { method: 'POST' };
    withAuthorizationHeader(original, secure, 'https://speed.example.com/__up');

    expect(original.headers).toBeUndefined();
  });

  it('returns the init untouched when there is no token', () => {
    const original: RequestInit = { method: 'POST' };
    const url = 'https://speed.example.com/__up';

    expect(
      withAuthorizationHeader(
        original,
        { token: null, allowInsecure: false },
        url
      )
    ).toBe(original);
    expect(
      withAuthorizationHeader(original, { token: '', allowInsecure: true }, url)
    ).toBe(original);
    expect(withAuthorizationHeader(original, null, url)).toBe(original);
    expect(withAuthorizationHeader(original, undefined, url)).toBe(original);
  });

  it('resolves relative URLs against the page origin', () => {
    stubOrigin('https://speed.example.com');

    expect(authOf(withAuthorizationHeader({}, secure, '/__down'))).toBe(
      `Bearer ${TOKEN}`
    );
  });

  it('attaches to absolute URLs without a DOM', () => {
    // Every default API URL is absolute, so constructing an engine with a token
    // must not require a DOM.
    expect(typeof window).toBe('undefined');

    expect(
      authOf(
        withAuthorizationHeader({}, secure, 'https://speed.example.com/__down')
      )
    ).toBe(`Bearer ${TOKEN}`);
  });

  it('returns the init untouched when there is no target URL', () => {
    const original: RequestInit = {};

    expect(withAuthorizationHeader(original, secure, null)).toBe(original);
    expect(withAuthorizationHeader(original, secure, undefined)).toBe(original);
  });

  describe('by default', () => {
    it('never attaches the token over plain HTTP', () => {
      expect(
        authOf(
          withAuthorizationHeader({}, secure, 'http://speed.example.com/__down')
        )
      ).toBeNull();
    });

    it('never attaches the token to a relative URL on an HTTP page', () => {
      stubOrigin('http://speed.example.com');

      expect(authOf(withAuthorizationHeader({}, secure, '/__down'))).toBeNull();
    });

    it('does not throw on a URL it cannot resolve, and withholds the token', () => {
      expect(typeof window).toBe('undefined');

      expect(() => withAuthorizationHeader({}, secure, '/__down')).not.toThrow();
      expect(authOf(withAuthorizationHeader({}, secure, '/__down'))).toBeNull();
      expect(authOf(withAuthorizationHeader({}, secure, 'not a url'))).toBeNull();
    });
  });

  describe('with allowInsecure', () => {
    it('attaches the token over plain HTTP', () => {
      expect(
        authOf(
          withAuthorizationHeader(
            {},
            insecureAllowed,
            'http://localhost:8787/__down'
          )
        )
      ).toBe(`Bearer ${TOKEN}`);
    });

    it('attaches the token to a relative URL on an HTTP page', () => {
      stubOrigin('http://localhost:3000');

      expect(authOf(withAuthorizationHeader({}, insecureAllowed, '/__down'))).toBe(
        `Bearer ${TOKEN}`
      );
    });

    it('attaches the token to a URL it cannot resolve', () => {
      // The flag means "stop policing transport", so an unresolvable target is
      // no longer a reason to withhold.
      expect(typeof window).toBe('undefined');

      expect(authOf(withAuthorizationHeader({}, insecureAllowed, '/__down'))).toBe(
        `Bearer ${TOKEN}`
      );
    });

    it('still leaves a secure request untouched by the escape hatch', () => {
      expect(
        authOf(
          withAuthorizationHeader(
            {},
            insecureAllowed,
            'https://speed.example.com/__down'
          )
        )
      ).toBe(`Bearer ${TOKEN}`);
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('warns once, not once per request', async () => {
      // The latch is module state, so this needs a fresh module instance.
      vi.resetModules();
      const { withAuthorizationHeader: fresh } = await import(
        '../../../src/utils/authorization.ts'
      );
      const url = 'http://localhost:8787/__down';

      fresh({}, insecureAllowed, url);
      fresh({}, insecureAllowed, url);
      fresh({}, insecureAllowed, 'http://localhost:8787/__up');

      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(vi.mocked(console.warn).mock.calls[0][0]).toContain(
        'allowInsecureAuthorizationToken'
      );
    });

    it('does not warn when there is no token to send', async () => {
      vi.resetModules();
      const { withAuthorizationHeader: fresh } = await import(
        '../../../src/utils/authorization.ts'
      );

      fresh({}, { token: null, allowInsecure: true }, 'http://localhost/__down');

      expect(console.warn).not.toHaveBeenCalled();
    });
  });
});
