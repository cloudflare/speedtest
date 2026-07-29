import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import defaultConfig from '../../../src/config/defaultConfig.ts';
import { applyAuthorizationToken } from '../../../src/utils/authorization.ts';

const TOKEN = 'test-token-123';

/** Merges user config over the defaults the way the engine constructors do. */
const resolveConfig = (userConfig: Partial<typeof defaultConfig>) =>
  applyAuthorizationToken(Object.assign({}, defaultConfig, userConfig));

/** Endpoints that bill against a customer and must carry the token. */
const BILLED_URL_KEYS = [
  'downloadApiUrl',
  'uploadApiUrl',
  'turnServerCredsApiUrl',
  'logAimApiUrl'
] as const;

describe('applyAuthorizationToken', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: { origin: 'https://speed.cloudflare.com' }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('attaches the token to every billed endpoint', () => {
    const config = resolveConfig({ authorizationToken: TOKEN });

    for (const key of BILLED_URL_KEYS) {
      expect(new URL(config[key]!).searchParams.get('token'), key).toBe(TOKEN);
    }
  });

  it('attaches the token to per-measurement logging when configured', () => {
    const config = resolveConfig({
      authorizationToken: TOKEN,
      logMeasurementApiUrl: 'https://speed.cloudflare.com/__log'
    });

    expect(
      new URL(config.logMeasurementApiUrl!).searchParams.get('token')
    ).toBe(TOKEN);
  });

  it('leaves disabled logging endpoints null', () => {
    const config = resolveConfig({
      authorizationToken: TOKEN,
      logAimApiUrl: null,
      logMeasurementApiUrl: null
    });

    expect(config.logAimApiUrl).toBeNull();
    expect(config.logMeasurementApiUrl).toBeNull();
  });

  it('does not attach the token to the RPKI probe host', () => {
    // Reachability/RPKI probes target unrelated hosts, not billed endpoints.
    const config = resolveConfig({ authorizationToken: TOKEN });

    expect(config.rpkiInvalidHost).toBe('invalid.rpki.cloudflare.com');
  });

  it('leaves every URL untouched when no token is configured', () => {
    const config = resolveConfig({});

    for (const key of BILLED_URL_KEYS) {
      expect(config[key], key).toBe(defaultConfig[key]);
    }
  });

  it('does not mutate the shared defaultConfig object', () => {
    // applyAuthorizationToken mutates in place, so it must only ever be handed
    // a freshly merged object — otherwise the token leaks across instances.
    resolveConfig({ authorizationToken: TOKEN });

    expect(defaultConfig.downloadApiUrl).toBe(
      'https://speed.cloudflare.com/__down'
    );
    expect(defaultConfig.logAimApiUrl).toBe(
      'https://speed.cloudflare.com/__results'
    );
    expect(defaultConfig.authorizationToken).toBeNull();
  });

  it('does not attach the token over plain HTTP', () => {
    const config = resolveConfig({
      authorizationToken: TOKEN,
      downloadApiUrl: 'http://speed.cloudflare.com/__down',
      uploadApiUrl: 'http://speed.cloudflare.com/__up'
    });

    expect(config.downloadApiUrl).toBe('http://speed.cloudflare.com/__down');
    expect(config.uploadApiUrl).toBe('http://speed.cloudflare.com/__up');
    // HTTPS endpoints in the same config are still attributed.
    expect(new URL(config.logAimApiUrl!).searchParams.get('token')).toBe(TOKEN);
  });
});
