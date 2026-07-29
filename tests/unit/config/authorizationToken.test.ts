import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import defaultConfig from '../../../src/config/defaultConfig.ts';
import {
  applyAuthorizationToken,
  TOKEN_URL_KEYS
} from '../../../src/utils/authorization.ts';

const TOKEN = 'test-token-123';

/** Merges user config over the defaults the way the engine constructors do. */
const resolveConfig = (userConfig: Partial<typeof defaultConfig>) =>
  applyAuthorizationToken(Object.assign({}, defaultConfig, userConfig));

describe('applyAuthorizationToken', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: { origin: 'https://speed.cloudflare.com' }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('attaches the token to every URL in TOKEN_URL_KEYS', () => {
    const config = resolveConfig({
      authorizationToken: TOKEN,
      // Null by default, so set it to cover every key in the list.
      logMeasurementApiUrl: 'https://speed.cloudflare.com/__log'
    });

    for (const key of TOKEN_URL_KEYS) {
      expect(new URL(config[key]!).searchParams.get('token'), key).toBe(TOKEN);
    }
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

  it('does not attach the token to excluded hosts', () => {
    const config = resolveConfig({ authorizationToken: TOKEN });

    expect(config.rpkiInvalidHost).toBe('invalid.rpki.cloudflare.com');
    expect(config.turnServerUri).toBe('turn.speed.cloudflare.com:50000');
  });

  it('leaves every URL untouched when no token is configured', () => {
    const config = resolveConfig({});

    for (const key of TOKEN_URL_KEYS) {
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
