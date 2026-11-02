import { describe, it, expect } from 'vitest';
import SpeedTestEngine from '../../../src/index.ts';
import type { ConfigOptions } from '../../../src/config/defaultConfig.ts';

/** `config` is protected, so a subclass is the supported way to inspect it. */
class InspectableEngine extends SpeedTestEngine {
  get resolvedConfig() {
    return this.config;
  }
}

const resolveConfig = (userConfig: ConfigOptions) =>
  new InspectableEngine({ autoStart: false, ...userConfig }).resolvedConfig;

const resolveAbort = (userConfig: ConfigOptions) =>
  resolveConfig(userConfig).abortRequestDuration;

describe('abortRequestDuration', () => {
  it('is disabled by default', () => {
    expect(resolveAbort({})).toBe(0);
  });

  it('accepts the new name', () => {
    expect(resolveAbort({ abortRequestDuration: 5_000 })).toBe(5_000);
  });

  it('still accepts the deprecated bandwidthAbortRequestDuration', () => {
    expect(resolveAbort({ bandwidthAbortRequestDuration: 5_000 })).toBe(5_000);
  });

  it('prefers the new name when both are set', () => {
    expect(
      resolveAbort({
        abortRequestDuration: 3_000,
        bandwidthAbortRequestDuration: 5_000
      })
    ).toBe(3_000);
    expect(
      resolveAbort({
        abortRequestDuration: 0,
        bandwidthAbortRequestDuration: 5_000
      })
    ).toBe(0);
  });

  it('keeps the deprecated key out of the resolved config', () => {
    const config = resolveConfig({ bandwidthAbortRequestDuration: 5_000 });
    expect(config).not.toHaveProperty('bandwidthAbortRequestDuration');
  });
});
