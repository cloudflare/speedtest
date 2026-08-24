import MeasurementCalculations from './MeasurementCalculations';
import type {
  BandwidthPoint,
  BandwidthResults,
  MeasurementCalcConfig,
  PacketLossResults
} from './MeasurementCalculations';
import ScoresCalculations from './ScoresCalculations';
import type {
  MeasurementSummary,
  Scores,
  ScoresCalcConfig
} from './ScoresCalculations';

// --- Config subset required by Results ---

interface MeasurementDef {
  type: string;
  [key: string]: unknown;
}

interface ResultsConfig extends MeasurementCalcConfig, ScoresCalcConfig {
  measurements: MeasurementDef[];
}

// --- Raw results shape ---

export interface RawMeasurementEntry {
  started: boolean;
  finished: boolean;
  /** Keyed by byte-size or measurement-specific keys. */
  results: Record<string, unknown>;
  /** Bandwidth types only — indicates the current round is done but more rounds remain. */
  finishedCurrentRound?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface RawResults {
  /** Excluding paused time (ms). */
  totalDurationMs: number | undefined;
  [key: string]: RawMeasurementEntry | number | undefined;
}

// --- Re-exports for consumers ---

export type {
  BandwidthPoint,
  BandwidthResults,
  PacketLossResults,
  MeasurementSummary,
  Scores
};

/**
 * Aggregates raw measurement data and exposes computed metrics (latency,
 * bandwidth, jitter, packet loss, scores) via getter methods.
 *
 * Instances are created internally by `MeasurementEngine` — consumers read
 * results through the engine's `results` property.
 */
class Results {
  constructor(config: ResultsConfig) {
    this.#config = config;
    this.clear();
    this.#measCalc = new MeasurementCalculations(this.#config);
    this.#scoresCalc = new ScoresCalculations(this.#config);
  }

  // Public attributes

  /**
   * The underlying raw measurement data, keyed by measurement type.
   *
   * Updated in-place by the engine as results arrive. Useful for building
   * custom visualisations or debugging; prefer the typed getter methods
   * for computed values.
   */
  raw!: RawResults;

  get isFinished(): boolean {
    return Object.values(this.raw)
      .filter(
        (d): d is RawMeasurementEntry => d !== null && typeof d === 'object'
      )
      .every(d => d.finished);
  }

  // Public methods

  clear(): void {
    this.raw = Object.assign(
      {
        totalDurationMs: undefined
      } as RawResults,
      ...[...new Set(this.#config.measurements.map(m => m.type))].map(m => ({
        [m]: { started: false, finished: false, results: {} }
      }))
    );
  }

  /** Unloaded latency at the configured percentile (ms), or `undefined` if not yet measured. */
  getUnloadedLatency = (): number | undefined =>
    this.#calcGetter('getLatency', 'latency');

  /** Unloaded jitter (ms), `null` if fewer than 2 samples, or `undefined` if not yet measured. */
  getUnloadedJitter = (): number | null | undefined =>
    this.#calcGetter('getJitter', 'latency');

  /** Raw unloaded latency ping values (ms). Returns `[]` if not yet measured. */
  getUnloadedLatencyPoints = (): number[] =>
    this.#calcGetter('getLatencyPoints', 'latency', []);

  /** Download loaded latency at the configured percentile (ms), or `undefined` if not yet measured. */
  getDownLoadedLatency = (): number | undefined =>
    this.#calcGetter('getLoadedLatency', 'download');

  /** Download loaded jitter (ms), `null` if fewer than 2 samples, or `undefined` if not yet measured. */
  getDownLoadedJitter = (): number | null | undefined =>
    this.#calcGetter('getLoadedJitter', 'download');

  /** Raw download loaded-latency ping values (ms). Returns `[]` if not yet measured. */
  getDownLoadedLatencyPoints = (): number[] =>
    this.#calcGetter('getLoadedLatencyPoints', 'download', []);

  /** Upload loaded latency at the configured percentile (ms), or `undefined` if not yet measured. */
  getUpLoadedLatency = (): number | undefined =>
    this.#calcGetter('getLoadedLatency', 'upload');

  /** Upload loaded jitter (ms), `null` if fewer than 2 samples, or `undefined` if not yet measured. */
  getUpLoadedJitter = (): number | null | undefined =>
    this.#calcGetter('getLoadedJitter', 'upload');

  /** Raw upload loaded-latency ping values (ms). Returns `[]` if not yet measured. */
  getUpLoadedLatencyPoints = (): number[] =>
    this.#calcGetter('getLoadedLatencyPoints', 'upload', []);

  /** Download bandwidth at the configured percentile (bits per second), or `undefined` if not yet measured. */
  getDownloadBandwidth = (): number | undefined =>
    this.#calcGetter('getBandwidth', 'download');

  /** Raw download bandwidth data points. Returns `[]` if not yet measured. */
  getDownloadBandwidthPoints = (): BandwidthPoint[] =>
    this.#calcGetter('getBandwidthPoints', 'download', []);

  /** Upload bandwidth at the configured percentile (bits per second), or `undefined` if not yet measured. */
  getUploadBandwidth = (): number | undefined =>
    this.#calcGetter('getBandwidth', 'upload');

  /** Raw upload bandwidth data points. Returns `[]` if not yet measured. */
  getUploadBandwidthPoints = (): BandwidthPoint[] =>
    this.#calcGetter('getBandwidthPoints', 'upload', []);

  /** Packet loss ratio (0–1), or `undefined` if not yet measured. */
  getPacketLoss = (): number | undefined =>
    this.#calcGetter('getPacketLoss', 'packetLoss');

  /** Detailed packet loss results, an `{ error }` object on failure, or `undefined` if not yet measured. */
  getPacketLossDetails = ():
    | PacketLossResults
    | { error: string }
    | undefined =>
    this.#calcGetter('getPacketLossDetails', 'packetLoss', undefined, true);

  /** Total test duration excluding paused time (ms), or `undefined` if still running. */
  getTotalDurationMs = (): number | undefined => this.raw.totalDurationMs;

  /**
   * Returns a flat summary of all available measurements.
   *
   * Only includes keys for measurement types that have produced results;
   * keys with `undefined` values are omitted from the returned object.
   */
  getSummary(): MeasurementSummary {
    const items: Record<string, () => unknown> = {
      download: this.getDownloadBandwidth,
      upload: this.getUploadBandwidth,
      latency: this.getUnloadedLatency,
      jitter: this.getUnloadedJitter,
      downLoadedLatency: this.getDownLoadedLatency,
      downLoadedJitter: this.getDownLoadedJitter,
      upLoadedLatency: this.getUpLoadedLatency,
      upLoadedJitter: this.getUpLoadedJitter,
      packetLoss: this.getPacketLoss,
      v4Reachability: this.#getV4Reachability,
      v6Reachability: this.#getV6Reachability,
      totalDurationMs: this.getTotalDurationMs
    };

    return Object.assign(
      {} as MeasurementSummary,
      ...Object.entries(items).map(([key, fn]) => {
        const val = fn();
        return val === undefined
          ? {}
          : {
              [key]: val
            };
      })
    );
  }

  /**
   * Computes AIM experience scores (streaming, gaming, rtc) from the current
   * measurement summary. Each score includes a point total, classification
   * index (0–4), and classification name (bad → great).
   */
  getScores = (): Scores => this.#scoresCalc.getScores(this.getSummary());

  // Internal state
  #config: ResultsConfig;
  #measCalc: MeasurementCalculations;
  #scoresCalc: ScoresCalculations;

  // Internal methods
  #calcGetter = (
    calcFn: keyof MeasurementCalculations,
    resKey: string,
    defaultVal: unknown = undefined,
    surfaceError = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): any => {
    const entry = this.raw[resKey];
    if (
      !entry ||
      typeof entry !== 'object' ||
      !(entry as RawMeasurementEntry).started
    )
      return defaultVal;
    const measEntry = entry as RawMeasurementEntry;
    if (surfaceError && measEntry.error) return { error: measEntry.error };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.#measCalc[calcFn] as (...args: any[]) => unknown)(
      measEntry.results
    );
  };

  #getV4Reachability = (): boolean | undefined =>
    this.#calcGetter('getReachability', 'v4Reachability');
  #getV4ReachabilityDetails = ():
    | { host: string; reachable: boolean }
    | undefined => this.#calcGetter('getReachabilityDetails', 'v4Reachability');
  #getV6Reachability = (): boolean | undefined =>
    this.#calcGetter('getReachability', 'v6Reachability');
  #getV6ReachabilityDetails = ():
    | { host: string; reachable: boolean }
    | undefined => this.#calcGetter('getReachabilityDetails', 'v6Reachability');
}

export default Results;
