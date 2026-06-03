export { default as defaultConfig } from './defaultConfig';
export { default as internalConfig } from './internalConfig';

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
