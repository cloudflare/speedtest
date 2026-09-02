import { describe, it, expect } from 'vitest';
import SpeedTestEngine from '../../../src/index.ts';
import defaultConfig, {
  type ConfigOptions
} from '../../../src/config/defaultConfig.ts';

const TOKEN = 'test-token-123';

/** `config` is protected, so a subclass is the supported way to inspect it. */
class InspectableEngine extends SpeedTestEngine {
  get resolvedConfig() {
    return this.config;
  }
}

const API_URL_KEYS = [
  'downloadApiUrl',
  'uploadApiUrl',
  'turnServerCredsApiUrl',
  'logAimApiUrl',
  'logMeasurementApiUrl'
] as const;

const resolveConfig = (userConfig: ConfigOptions = {}) =>
  new InspectableEngine({ autoStart: false, ...userConfig }).resolvedConfig;

describe('authorizationToken', () => {
  it('never appears in any configured API URL', () => {
    const config = resolveConfig({
      authorizationToken: TOKEN,
      // Null by default, so set it to cover every key in the list.
      logMeasurementApiUrl: 'https://speed.cloudflare.com/__log'
    });

    for (const key of API_URL_KEYS) {
      expect(config[key] ?? '', key).not.toContain(TOKEN);
    }
  });

  it('leaves the configured API URLs exactly as given', () => {
    const config = resolveConfig({ authorizationToken: TOKEN });

    for (const key of API_URL_KEYS) {
      expect(config[key], key).toBe(defaultConfig[key]);
    }
  });

  it('is preserved on the config so the engines can attach it', () => {
    expect(
      resolveConfig({ authorizationToken: TOKEN }).authorizationToken
    ).toBe(TOKEN);
  });

  it('defaults to null', () => {
    expect(resolveConfig({}).authorizationToken).toBeNull();
    expect(defaultConfig.authorizationToken).toBeNull();
  });

  describe('authorizationEnabled', () => {
    it('defaults to undefined, so a token alone is never sent', () => {
      expect(resolveConfig({}).authorizationEnabled).toBeUndefined();
      expect(defaultConfig.authorizationEnabled).toBeUndefined();
      expect(
        resolveConfig({ authorizationToken: TOKEN }).authorizationEnabled
      ).toBeUndefined();
    });

    it.each(['header', true, false] as const)(
      'survives the config merge as %o',
      value => {
        expect(
          resolveConfig({
            authorizationToken: TOKEN,
            authorizationEnabled: value
          }).authorizationEnabled
        ).toBe(value);
      }
    );
  });

  describe('allowInsecureAuthorizationToken', () => {
    it('defaults to false, so the token is HTTPS-only unless asked otherwise', () => {
      expect(resolveConfig({}).allowInsecureAuthorizationToken).toBe(false);
      expect(defaultConfig.allowInsecureAuthorizationToken).toBe(false);
    });

    it('survives the config merge when opted into', () => {
      expect(
        resolveConfig({
          authorizationToken: TOKEN,
          allowInsecureAuthorizationToken: true
        }).allowInsecureAuthorizationToken
      ).toBe(true);
    });

    it('still keeps the token out of every URL', () => {
      const config = resolveConfig({
        authorizationToken: TOKEN,
        allowInsecureAuthorizationToken: true,
        logMeasurementApiUrl: 'http://localhost:8787/__log'
      });

      for (const key of API_URL_KEYS) {
        expect(config[key] ?? '', key).not.toContain(TOKEN);
      }
    });
  });

  it('leaves the non-HTTP endpoints untouched', () => {
    const config = resolveConfig({ authorizationToken: TOKEN });

    expect(config.rpkiInvalidHost).toBe('invalid.rpki.cloudflare.com');
    expect(config.turnServerUri).toBe('turn.speed.cloudflare.com:50000');
  });

  it('does not mutate the shared defaultConfig object', () => {
    resolveConfig({ authorizationToken: TOKEN });

    expect(defaultConfig.downloadApiUrl).toBe(
      'https://speed.cloudflare.com/__down'
    );
    expect(defaultConfig.logAimApiUrl).toBe(
      'https://speed.cloudflare.com/__results'
    );
    expect(defaultConfig.authorizationToken).toBeNull();
  });
});
