import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import LoadNetworkEngine from '../../../src/engines/LoadNetworkEngine';
import type { AuthorizationOptions } from '../../../src/utils/authorization';

/**
 * The load generator saturates the same `__down`/`__up` endpoints as a real
 * measurement, so it has to carry the token too. It is covered here because
 * the e2e suite skips packet loss (CORS), which is the only path that builds
 * one — an unwrapped fetch here would otherwise go unnoticed.
 */

const TOKEN = 'eyJhbGciOiJFUzI1NiJ9.payload.signature';

const auth = (
  overrides: Partial<AuthorizationOptions> = {}
): AuthorizationOptions => ({
  token: TOKEN,
  enabled: 'header',
  allowInsecure: false,
  ...overrides
});

/** Every URL the engine fetched, paired with its Authorization header. */
const fetchedWithAuth = (): [string, string | null][] =>
  vi
    .mocked(globalThis.fetch)
    .mock.calls.map(([url, init]) => [
      String(url),
      new Headers(init?.headers).get('authorization')
    ]);

describe('LoadNetworkEngine authorization', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: { origin: 'https://speed.example.com' }
    });
    // Never resolves: one iteration per engine is enough, and the loop cannot
    // schedule another while the previous fetch is pending.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the token on download load requests', () => {
    const engine = new LoadNetworkEngine({
      download: { apiUrl: 'https://speed.example.com/__down', chunkSize: 1e5 },
      authorization: auth()
    });
    engine.stop();

    expect(fetchedWithAuth()).toEqual([
      [
        'https://speed.example.com/__down?bytes=100000',
        `Bearer ${TOKEN}`
      ]
    ]);
  });

  it('sends the token on upload load requests', () => {
    const engine = new LoadNetworkEngine({
      upload: { apiUrl: 'https://speed.example.com/__up', chunkSize: 10 },
      authorization: auth()
    });
    engine.stop();

    expect(fetchedWithAuth()).toEqual([
      ['https://speed.example.com/__up', `Bearer ${TOKEN}`]
    ]);
  });

  it('sends the token on both loops at once', () => {
    const engine = new LoadNetworkEngine({
      download: { apiUrl: 'https://speed.example.com/__down', chunkSize: 1e5 },
      upload: { apiUrl: 'https://speed.example.com/__up', chunkSize: 10 },
      authorization: auth()
    });
    engine.stop();

    expect(fetchedWithAuth().map(([, header]) => header)).toEqual([
      `Bearer ${TOKEN}`,
      `Bearer ${TOKEN}`
    ]);
  });

  it('keeps the upload method and body while adding the header', () => {
    const engine = new LoadNetworkEngine({
      upload: { apiUrl: 'https://speed.example.com/__up', chunkSize: 4 },
      authorization: auth()
    });
    engine.stop();

    const init = vi.mocked(globalThis.fetch).mock.calls[0][1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('0000');
  });

  it('sends nothing when authorization was not opted in', () => {
    const engine = new LoadNetworkEngine({
      download: { apiUrl: 'https://speed.example.com/__down', chunkSize: 1e5 },
      authorization: auth({ enabled: undefined })
    });
    engine.stop();

    expect(fetchedWithAuth()[0][1]).toBeNull();
  });

  it('sends nothing when no authorization is supplied at all', () => {
    const engine = new LoadNetworkEngine({
      download: { apiUrl: 'https://speed.example.com/__down', chunkSize: 1e5 }
    });
    engine.stop();

    expect(fetchedWithAuth()[0][1]).toBeNull();
  });

  it('withholds the token from a plain-HTTP endpoint', () => {
    const engine = new LoadNetworkEngine({
      download: { apiUrl: 'http://speed.example.com/__down', chunkSize: 1e5 },
      authorization: auth()
    });
    engine.stop();

    expect(fetchedWithAuth()[0][1]).toBeNull();
  });
});
