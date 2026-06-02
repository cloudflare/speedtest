import scaleThreshold from '../utils/scaleThreshold';

import { sum } from '../utils/numbers';

// --- Types ---

/** Human-readable quality classification (worst to best). */
export type ClassificationName = 'bad' | 'poor' | 'average' | 'good' | 'great';

/** AIM experience score for a single use-case (e.g. streaming, gaming, rtc). */
export interface ExperienceScore {
  /** Aggregate point total (higher is better). */
  points: number;
  /** Classification bucket index (0 = bad, 4 = great). */
  classificationIdx: number;
  classificationName: ClassificationName;
}

export type Scores = Record<string, ExperienceScore>;

/** Flat measurement summary values (the output of {@link Results.getSummary}). */
export interface MeasurementSummary {
  /** Download bandwidth (bits per second). */
  download?: number;
  /** Upload bandwidth (bits per second). */
  upload?: number;
  /** Unloaded latency (ms). */
  latency?: number;
  /** Unloaded jitter (ms). */
  jitter?: number;
  /** Download loaded latency (ms). */
  downLoadedLatency?: number;
  /** Download loaded jitter (ms). */
  downLoadedJitter?: number;
  /** Upload loaded latency (ms). */
  upLoadedLatency?: number;
  /** Upload loaded jitter (ms). */
  upLoadedJitter?: number;
  /** Packet loss ratio (0–1). */
  packetLoss?: number;
  v4Reachability?: boolean;
  v6Reachability?: boolean;
  /** Total test duration excluding paused time (ms). */
  totalDurationMs?: number;
  [key: string]: number | boolean | undefined;
}

/** Definition of an AIM experience (e.g. streaming), listing its input metrics and score thresholds. */
export interface ExperienceDef {
  /** Metric keys whose scores are summed to produce the experience score. */
  input: string[];
  /** Point thresholds that map the sum to a classification (bad → great). */
  pointThresholds: number[];
}

export interface ScoresCalcConfig {
  /** Maps each metric key to a function that converts a raw value to AIM points. */
  aimMeasurementScoring: Record<string, (val: number) => number>;
  /** Defines each experience category, its input metrics, and classification thresholds. */
  aimExperiencesDefs: Record<string, ExperienceDef>;
}

// --- Module-level constants ---

const classificationNames: readonly ClassificationName[] = [
  'bad',
  'poor',
  'average',
  'good',
  'great'
];

const customResultTypes: Record<
  string,
  (measurements: MeasurementSummary) => number | undefined
> = {
  loadedLatencyIncrease: (measurements: MeasurementSummary) =>
    measurements.latency &&
    (measurements.downLoadedLatency || measurements.upLoadedLatency)
      ? Math.max(
          measurements.downLoadedLatency as number,
          measurements.upLoadedLatency as number
        ) - (measurements.latency as number)
      : undefined
};

const defaultPoints: Record<string, number> = {
  packetLoss: 0
};

/**
 * Computes AIM (Aggregated Internet Measurement) experience scores from
 * a measurement summary.
 *
 * Each metric (latency, bandwidth, jitter, packet loss, etc.) is first
 * converted to AIM points via threshold-based scoring functions, then the
 * points for each experience category (streaming, gaming, rtc) are summed
 * and mapped to a classification from "bad" to "great".
 */
class ScoresCalculations {
  constructor(config: ScoresCalcConfig) {
    this.#config = config;
  }

  /**
   * Computes AIM scores for each experience category.
   *
   * 1. Each metric in `aimMeasurementScoring` is scored independently
   *    using threshold-based point functions.
   * 2. For each experience (streaming, gaming, rtc), the relevant metric
   *    scores are summed. The sum is clamped to a minimum of 0.
   * 3. The sum is mapped to a classification (bad/poor/average/good/great)
   *    via the experience's `pointThresholds`.
   *
   * Experiences are omitted from the result if any of their required
   * input metrics are not yet available.
   *
   * @param measurements - Flat summary from {@link Results.getSummary}.
   * @returns Map of experience names to their score, classification index, and classification name.
   */
  getScores(measurements: MeasurementSummary): Scores {
    const scores: Record<string, number> = Object.assign(
      {} as Record<string, number>,
      ...Object.entries(this.#config.aimMeasurementScoring).map(
        ([type, fn]) => {
          const val = customResultTypes.hasOwnProperty(type)
            ? customResultTypes[type](measurements)
            : (measurements[type] as number | undefined);
          return val === undefined
            ? defaultPoints.hasOwnProperty(type)
              ? { [type]: defaultPoints[type] }
              : {}
            : {
                [type]: +fn(val)
              };
        }
      )
    );

    return Object.assign(
      {} as Scores,
      ...Object.entries(this.#config.aimExperiencesDefs)
        .filter(([, { input }]) => input.every(k => scores.hasOwnProperty(k)))
        .map(([k, { input, pointThresholds }]) => {
          const sumPoints = Math.max(0, sum(input.map(k => scores[k])));
          const classificationIdx = scaleThreshold(
            pointThresholds,
            [0, 1, 2, 3, 4]
          )(sumPoints) as number;
          const classificationName = classificationNames[classificationIdx];
          return {
            [k]: {
              points: sumPoints,
              classificationIdx,
              classificationName
            }
          };
        })
    );
  }

  // Internal state
  #config: ScoresCalcConfig;
}

export default ScoresCalculations;
