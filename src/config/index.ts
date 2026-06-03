export { default as defaultConfig } from './defaultConfig';
export { default as internalConfig } from './internalConfig';

// NOTE: `Config` is internal-only — intentionally NOT re-exported from
// src/index.ts. The public surface is `ConfigOptions = Partial<Config>`.
export type {
  Config,
  ConfigOptions,
  MeasurementConfig,
  LatencyMeasurementConfig,
  BandwidthMeasurementConfig,
  PacketLossMeasurementConfig
} from './defaultConfig';
export type {
  InternalConfig,
  AimMetricKey,
  AimExperienceKey,
  AimExperienceDef
} from './internalConfig';
