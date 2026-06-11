/**
 * Shared interfaces used across the speed-test library.
 *
 * Data-structure types consumed by {@link Results} and the measurement engines.
 */

export interface LatencyTiming {
  /** Round-trip latency to the measurement endpoint (ms). */
  ping: number;
}

export interface LatencyResults {
  timings: LatencyTiming[];
}

/**
 * Raw timing data produced by a single bandwidth (download / upload) request.
 */
export interface BandwidthTiming {
  /** Bits per second. */
  bps: number;

  /** Total request duration excluding server processing time (ms). */
  duration: number;

  /** Round-trip latency to the measurement endpoint (ms). */
  ping: number;

  /** Timestamp when the measurement sample was recorded. */
  measTime: Date;

  /**
   * Server-side processing time in milliseconds, extracted from the
   * `Server-Timing` response header. `-1` when unavailable.
   */
  serverTime: number;

  /** Actual number of bytes transferred (from `PerformanceResourceTiming`). */
  transferSize: number;

  /**
   * Server-accepted upload size (bytes), from the `cf-meta-upload-bytes`
   * response header. Present only for upload requests where the server
   * reported how much of the body it accepted (e.g. when it caps the upload).
   */
  uploadBytes?: number;
}

/**
 * A group of bandwidth timings for a single payload size, plus optional
 * side-channel latency samples collected in parallel.
 */
export interface BandwidthBucket {
  timings: BandwidthTiming[];

  /**
   * Latency samples collected in parallel with the bandwidth requests
   * (loaded latency). Present only when parallel-latency measurement is
   * enabled.
   */
  sideLatency?: LatencyTiming[];
}

/**
 * All bandwidth results keyed by payload byte-size (as a string).
 *
 * Used by {@link Results} and `MeasurementCalculations` to compute aggregate
 * bandwidth, loaded latency, and loaded jitter.
 */
export type BandwidthResults = Record<string, BandwidthBucket>;

/**
 * A single data point derived from a bandwidth measurement, enriched with the
 * originating payload size. Returned by `getBandwidthPoints()`.
 */
export interface BandwidthPoint {
  /** Payload size in bytes. */
  bytes: number;

  /** Bits per second. */
  bps: number;

  /** Total request duration excluding server processing time (ms). */
  duration: number;

  /** Round-trip latency to the measurement endpoint (ms). */
  ping: number;

  /** Timestamp when the measurement sample was recorded. */
  measTime: Date;

  /** Milliseconds. `-1` when unavailable. */
  serverTime: number;

  /** From `PerformanceResourceTiming`. */
  transferSize: number;

  /**
   * Server-accepted upload size (bytes), from the `cf-meta-upload-bytes`
   * response header. Present only for upload points where the server reported
   * how much of the body it accepted.
   */
  uploadBytes?: number;
}

/** Results from a packet-loss measurement via WebRTC TURN relay. */
export interface PacketLossResults {
  /** Total number of messages the test was configured to send. */
  totalMessages: number;

  /** Number of messages actually sent (may differ if sending was cut short). */
  numMessagesSent: number;

  /**
   * Fraction of sent messages that were lost (0 – 1).
   * Computed as `lostMessages.length / numMessagesSent`.
   */
  packetLoss: number;

  /** Sequence numbers of the messages that were not echoed back. */
  lostMessages: number[];
}

/** Results from a simple reachability (fetch) check against a host. */
export interface ReachabilityResults {
  host: string;
  reachable: boolean;
}
