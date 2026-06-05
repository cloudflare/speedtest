import type {
  BandwidthPoint,
  BandwidthResults,
  LatencyResults,
  LatencyTiming,
  PacketLossResults,
  ReachabilityResults
} from '../types';
import { percentile } from '../utils/numbers';

export type { BandwidthPoint, BandwidthResults, PacketLossResults };

// --- Config subset used by MeasurementCalculations ---

export interface MeasurementCalcConfig {
  /** Percentile (0–1) used for latency calculation. */
  latencyPercentile: number;
  /** Percentile (0–1) used for bandwidth calculation. */
  bandwidthPercentile: number;
  /** Minimum request duration (ms) for a sample to count toward bandwidth. */
  bandwidthMinRequestDuration: number;
  /** Minimum request duration (ms) for a round to be considered "loading" the connection. */
  loadedRequestMinDuration: number;
  /** Maximum number of loaded-latency points to retain. */
  loadedLatencyMaxPoints: number;
}

/**
 * Computes derived metrics (latency, jitter, bandwidth, packet loss) from
 * raw measurement data using percentile-based aggregation.
 */
class MeasurementCalculations {
  constructor(config: MeasurementCalcConfig) {
    this.#config = config;
  }

  // Public methods

  getLatencyPoints = (latencyResults: LatencyResults): number[] =>
    latencyResults.timings.map(d => d.ping);

  /**
   * Computes latency (ms) as the configured percentile of all ping samples.
   *
   * Uses the `latencyPercentile` config value (default: median).
   */
  getLatency = (latencyResults: LatencyResults): number =>
    percentile(
      this.getLatencyPoints(latencyResults),
      this.#config.latencyPercentile
    );

  /**
   * Computes jitter (ms) as the mean absolute difference between consecutive
   * latency samples. Returns `null` if fewer than 2 samples are available.
   */
  getJitter(latencyResults: LatencyResults): number | null {
    // calc jitter as the average latency delta between consecutive samples
    const pings = this.getLatencyPoints(latencyResults);
    return pings.length < 2
      ? null
      : (
          pings.reduce(
            (
              { sumDeltas = 0, prevLatency }: JitterAccumulator,
              latency: number
            ): JitterAccumulator => ({
              sumDeltas:
                sumDeltas +
                (prevLatency !== undefined
                  ? Math.abs(prevLatency - latency)
                  : 0),
              prevLatency: latency
            }),
            {} as JitterAccumulator
          ) as Required<JitterAccumulator>
        ).sumDeltas /
          (pings.length - 1);
  }

  getBandwidthPoints = (bandwidthResults: BandwidthResults): BandwidthPoint[] =>
    Object.entries(bandwidthResults)
      .map(([bytes, { timings }]) =>
        timings.map(
          ({ bps, duration, ping, measTime, serverTime, transferSize }) => ({
            bytes: +bytes,
            bps,
            duration,
            ping,
            measTime,
            serverTime,
            transferSize
          })
        )
      )
      .flat();

  /**
   * Computes bandwidth (bits per second) as the configured percentile of all
   * samples whose duration exceeds `bandwidthMinRequestDuration`.
   *
   * Short requests are filtered out because they don't saturate the
   * connection and would skew the result downward.
   */
  getBandwidth = (bandwidthResults: BandwidthResults): number =>
    percentile(
      this.getBandwidthPoints(bandwidthResults)
        .filter(d => d.duration >= this.#config.bandwidthMinRequestDuration)
        .map(d => d.bps)
        .filter(bps => bps),
      this.#config.bandwidthPercentile
    );

  /**
   * Computes loaded latency (ms) from side-channel pings collected during
   * bandwidth measurement. Only considers buckets where the minimum request
   * duration exceeds `loadedRequestMinDuration`, and keeps only the last
   * `loadedLatencyMaxPoints` samples (most recent are most accurate).
   */
  getLoadedLatency = (loadedResults: BandwidthResults): number =>
    this.getLatency({ timings: this.#extractLoadedLatencies(loadedResults) });

  /**
   * Computes loaded jitter (ms) using the same filtered side-channel pings
   * as {@link getLoadedLatency}. Returns `null` if fewer than 2 samples.
   */
  getLoadedJitter = (loadedResults: BandwidthResults): number | null =>
    this.getJitter({ timings: this.#extractLoadedLatencies(loadedResults) });

  getLoadedLatencyPoints = (loadedResults: BandwidthResults): number[] =>
    this.getLatencyPoints({
      timings: this.#extractLoadedLatencies(loadedResults)
    });

  /** @returns Packet loss ratio (0–1). */
  getPacketLoss = (plResults: PacketLossResults): number =>
    plResults.packetLoss;

  getPacketLossDetails = (plResults: PacketLossResults): PacketLossResults =>
    plResults;

  getReachability = (reachabilityResults: ReachabilityResults): boolean =>
    !!reachabilityResults.reachable;

  getReachabilityDetails = (
    d: ReachabilityResults
  ): { host: string; reachable: boolean } => ({
    host: d.host,
    reachable: d.reachable
  });

  // Internal state
  #config: MeasurementCalcConfig;

  // Internal methods
  #extractLoadedLatencies = (
    loadedResults: BandwidthResults
  ): LatencyTiming[] =>
    Object.values(loadedResults)
      .filter(
        // keep only file sizes that saturated the connection
        d =>
          d.timings.length &&
          Math.min(...d.timings.map(d => d.duration)) >=
            this.#config.loadedRequestMinDuration
      )
      .map(d => d.sideLatency || [])
      .flat()
      .slice(-this.#config.loadedLatencyMaxPoints); // last measurements are most accurate
}

/** Internal accumulator for the jitter reduce. */
interface JitterAccumulator {
  sumDeltas?: number;
  prevLatency?: number;
}

export default MeasurementCalculations;
