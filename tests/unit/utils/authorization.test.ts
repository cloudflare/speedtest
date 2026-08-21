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

/** A fresh object per call: the insecure warning is latched per options object. */
const auth = (
  overrides: Partial<AuthorizationOptions> = {}
): AuthorizationOptions => ({
  token: TOKEN,
  enabled: 'header',
  allowInsecure: false,
  ...overrides
});

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
      auth(),
      'https://speed.example.com/__down'
    );

    expect(authOf(init)).toBe(`Bearer ${TOKEN}`);
  });

  it('never puts the token in the URL', () => {
    // The whole point of the header: no caller may end up logging the token.
    const apiUrl = 'https://speed.example.com/__down?bytes=100000';
    const init = withAuthorizationHeader({}, auth(), apiUrl);

    // The helper takes the URL by value and cannot rewrite it, so the check
    // that matters is that the token travels in the header instead.
    expect(apiUrl).not.toContain(TOKEN);
    expect(authOf(init)).toBe(`Bearer ${TOKEN}`);
    expect(init).not.toHaveProperty('url');
  });

  it('preserves the rest of the request init', () => {
    const body = 'payload';
    const init = withAuthorizationHeader(
      { method: 'POST', body, credentials: 'include' },
      auth(),
      'https://speed.example.com/__up'
    );

    expect(init.method).toBe('POST');
    expect(init.body).toBe(body);
    expect(init.credentials).toBe('include');
  });

  it('preserves headers the caller already set', () => {
    const init = withAuthorizationHeader(
      { headers: { 'content-type': 'text/plain' } },
      auth(),
      'https://speed.example.com/__log'
    );

    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('text/plain');
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('returns headers as a plain object, not a Headers instance', () => {
    const init = withAuthorizationHeader(
      { headers: { 'content-type': 'text/plain' } },
      auth(),
      'https://speed.example.com/__log'
    );

    expect(init.headers).not.toBeInstanceOf(Headers);
    expect(init.headers).toEqual({
      'content-type': 'text/plain',
      authorization: `Bearer ${TOKEN}`
    });
  });

  it('does not mutate the init it was given', () => {
    const original: RequestInit = { method: 'POST' };
    withAuthorizationHeader(original, auth(), 'https://speed.example.com/__up');

    expect(original.headers).toBeUndefined();
  });

  it('returns the init untouched when there is no target URL', () => {
    const original: RequestInit = {};

    expect(withAuthorizationHeader(original, auth(), null)).toBe(original);
    expect(withAuthorizationHeader(original, auth(), undefined)).toBe(original);
  });

  it('resolves relative URLs against the page origin', () => {
    stubOrigin('https://speed.example.com');

    expect(authOf(withAuthorizationHeader({}, auth(), '/__down'))).toBe(
      `Bearer ${TOKEN}`
    );
  });

  it('attaches to absolute URLs without a DOM', () => {
    // Every default API URL is absolute, so constructing an engine with a token
    // must not require a DOM.
    expect(typeof window).toBe('undefined');

    expect(
      authOf(
        withAuthorizationHeader({}, auth(), 'https://speed.example.com/__down')
      )
    ).toBe(`Bearer ${TOKEN}`);
  });

  describe('enabled', () => {
    const url = 'https://speed.example.com/__down';

    it("sends the token for 'header'", () => {
      expect(authOf(withAuthorizationHeader({}, auth(), url))).toBe(
        `Bearer ${TOKEN}`
      );
    });

    it('sends the token for true, which is an alias for header', () => {
      expect(
        authOf(withAuthorizationHeader({}, auth({ enabled: true }), url))
      ).toBe(`Bearer ${TOKEN}`);
    });

    it('withholds a token that was never opted in', () => {
      // A token alone must not be sent: opting in is explicit.
      const original: RequestInit = { method: 'GET' };

      expect(
        withAuthorizationHeader(original, auth({ enabled: undefined }), url)
      ).toBe(original);
      expect(
        withAuthorizationHeader(original, auth({ enabled: false }), url)
      ).toBe(original);
    });

    it('returns the init untouched when there is no authorization at all', () => {
      const original: RequestInit = { method: 'GET' };

      expect(withAuthorizationHeader(original, null, url)).toBe(original);
      expect(withAuthorizationHeader(original, undefined, url)).toBe(original);
    });
  });

  describe('token values', () => {
    const url = 'https://speed.example.com/__down';

    it('returns the init untouched when there is no token', () => {
      const original: RequestInit = { method: 'POST' };

      expect(
        withAuthorizationHeader(original, auth({ token: null }), url)
      ).toBe(original);
      expect(withAuthorizationHeader(original, auth({ token: '' }), url)).toBe(
        original
      );
    });

    it('treats a whitespace-only token as absent', () => {
      const original: RequestInit = { method: 'POST' };

      expect(withAuthorizationHeader(original, auth({ token: ' ' }), url)).toBe(
        original
      );
      expect(
        withAuthorizationHeader(original, auth({ token: '\t\n ' }), url)
      ).toBe(original);
    });

    it('trims a padded token rather than sending the padding', () => {
      expect(
        authOf(
          withAuthorizationHeader({}, auth({ token: `  ${TOKEN}\n` }), url)
        )
      ).toBe(`Bearer ${TOKEN}`);
    });
  });

  describe('by default', () => {
    it('never attaches the token over plain HTTP', () => {
      expect(
        authOf(
          withAuthorizationHeader({}, auth(), 'http://speed.example.com/__down')
        )
      ).toBeNull();
    });

    it('never attaches the token to a relative URL on an HTTP page', () => {
      stubOrigin('http://speed.example.com');

      expect(authOf(withAuthorizationHeader({}, auth(), '/__down'))).toBeNull();
    });

    it('does not throw on a URL it cannot resolve, and withholds the token', () => {
      expect(typeof window).toBe('undefined');

      expect(() =>
        withAuthorizationHeader({}, auth(), '/__down')
      ).not.toThrow();
      expect(authOf(withAuthorizationHeader({}, auth(), '/__down'))).toBeNull();
      expect(
        authOf(withAuthorizationHeader({}, auth(), 'not a url'))
      ).toBeNull();
    });
  });

  describe('with allowInsecure', () => {
    const insecure = (): AuthorizationOptions => auth({ allowInsecure: true });

    it('attaches the token over plain HTTP', () => {
      expect(
        authOf(
          withAuthorizationHeader(
            {},
            insecure(),
            'http://localhost:8787/__down'
          )
        )
      ).toBe(`Bearer ${TOKEN}`);
    });

    it('attaches the token to a relative URL on an HTTP page', () => {
      stubOrigin('http://localhost:3000');

      expect(authOf(withAuthorizationHeader({}, insecure(), '/__down'))).toBe(
        `Bearer ${TOKEN}`
      );
    });

    it('attaches the token to a URL it cannot resolve', () => {
      // The flag means "stop policing transport", so an unresolvable target is
      // no longer a reason to withhold.
      expect(typeof window).toBe('undefined');

      expect(authOf(withAuthorizationHeader({}, insecure(), '/__down'))).toBe(
        `Bearer ${TOKEN}`
      );
    });

    it('does not warn when the target is secure', () => {
      withAuthorizationHeader(
        {},
        insecure(),
        'https://speed.example.com/__down'
      );

      expect(console.warn).not.toHaveBeenCalled();
    });

    it('warns once per engine, not once per request', () => {
      // One options object is built per engine, so the latch is per run.
      const shared = insecure();

      withAuthorizationHeader({}, shared, 'http://localhost:8787/__down');
      withAuthorizationHeader({}, shared, 'http://localhost:8787/__down');
      withAuthorizationHeader({}, shared, 'http://localhost:8787/__up');

      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(vi.mocked(console.warn).mock.calls[0][0]).toContain(
        'allowInsecureAuthorizationToken'
      );
    });

    it('warns again for a new engine, so a second run is not silent', () => {
      const url = 'http://localhost:8787/__down';

      withAuthorizationHeader({}, insecure(), url);
      withAuthorizationHeader({}, insecure(), url);

      expect(console.warn).toHaveBeenCalledTimes(2);
    });

    it('does not warn when there is no token to send', () => {
      withAuthorizationHeader(
        {},
        auth({ allowInsecure: true, token: null }),
        'http://localhost:8787/__down'
      );

      expect(console.warn).not.toHaveBeenCalled();
    });

    it('does not warn when sending was never enabled', () => {
      withAuthorizationHeader(
        {},
        auth({ allowInsecure: true, enabled: undefined }),
        'http://localhost:8787/__down'
      );

      expect(console.warn).not.toHaveBeenCalled();
    });
  });
});
