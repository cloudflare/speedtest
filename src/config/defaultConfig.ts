export interface LatencyMeasurementConfig {
  type: 'latency';
  /** Number of latency pings to send in this phase. */
  numPackets: number;
}

export interface BandwidthMeasurementConfig {
  type: 'download' | 'upload';
  /** Payload size per HTTP request in bytes (e.g., 1e5 = 100KB, 1e7 = 10MB). */
  bytes: number;
  /** Number of requests to issue at this payload size. */
  count: number;
  /** If `true`, skip the minimum-duration filter for this round. */
  bypassMinDuration?: boolean;
}

/** WebRTC TURN-based packet loss measurement phase. */
export interface PacketLossMeasurementConfig {
  type: 'packetLoss';
  /** Total number of UDP messages to send through the TURN relay. */
  numPackets: number;
  /** Number of messages sent in each batch. */
  batchSize: number;
  /** Delay between consecutive batches (ms). */
  batchWaitTime: number;
  /** Time to wait for outstanding responses after the last batch (ms). */
  responsesWaitTime: number;
  /** Timeout for the WebRTC connection setup (ms). */
  connectionTimeout?: number;
}

export type MeasurementConfig =
  | LatencyMeasurementConfig
  | BandwidthMeasurementConfig
  | PacketLossMeasurementConfig;

/**
 * Fully-specified speed test configuration — every option present.
 *
 * This is the shape of {@link defaultConfig}. Consumers don't construct this
 * directly; they pass a {@link ConfigOptions} (a partial) to the engine, which
 * merges it over the defaults.
 */
export interface Config {
  /** Whether to start the test immediately on construction. Default: `true`. */
  autoStart: boolean;

  /** URL for download requests. Default: `https://speed.cloudflare.com/__down`. */
  downloadApiUrl: string;
  /** URL for upload requests. Default: `https://speed.cloudflare.com/__up`. */
  uploadApiUrl: string;
  /** URL for per-measurement logging. Set to `null` to disable. Default: `null`. */
  logMeasurementApiUrl: string | null;
  /** URL for AIM score logging. Set to `null` to disable. Default: `https://aim.cloudflare.com/__log`. */
  logAimApiUrl: string | null;
  /** TURN server URI for packet loss measurement. Default: `turn.speed.cloudflare.com:50000`. */
  turnServerUri: string;
  /** URL for fetching TURN server credentials. */
  turnServerCredsApiUrl: string;
  /** Static TURN username override. Set to `null` to fetch credentials dynamically. */
  turnServerUser: string | null;
  /** Static TURN password override. Set to `null` to fetch credentials dynamically. */
  turnServerPass: string | null;
  /** Hostname used to test RPKI invalid-route filtering. */
  rpkiInvalidHost: string;
  /** Whether to include credentials (cookies) in fetch requests. Default: `false`. */
  includeCredentials: boolean;
  /** Optional session ID attached to measurement logs. */
  sessionId: string | undefined;

  /**
   * Ordered list of measurement phases to execute.
   *
   * Each entry describes a latency, bandwidth, or packet loss step.
   * The engine executes them sequentially, skipping further rounds of a
   * bandwidth type once its finish threshold is reached.
   */
  measurements: MeasurementConfig[];
  measureDownloadLoadedLatency: boolean;
  measureUploadLoadedLatency: boolean;
  /** Minimum interval between loaded-latency pings (ms). Default: `400`. */
  loadedLatencyThrottle: number;
  /**
   * Per-request duration threshold (ms) that, once reached, stops further
   * measurement rounds of that bandwidth type. Default: `1000`.
   */
  bandwidthFinishRequestDuration: number;
  /**
   * Estimated server processing time (ms) subtracted from raw latency when
   * the server doesn't report its own processing time in headers. Default: `10`.
   */
  estimatedServerTime: number;

  /**
   * Per-request duration (ms) at which to abort the current request and stop
   * further rounds of that bandwidth type. Set to `0` to disable. Default: `0`.
   */
  bandwidthAbortRequestDuration: number;

  /** Percentile used to compute latency from the sample set (0–1). Default: `0.5` (median). */
  latencyPercentile: number;
  /** Percentile used to compute bandwidth from the sample set (0–1). Default: `0.9`. */
  bandwidthPercentile: number;
  /** Minimum request duration (ms) for a sample to be included in bandwidth calculation. Default: `10`. */
  bandwidthMinRequestDuration: number;
  /** Minimum request duration (ms) for a download/upload round to be considered "loading" the connection. Default: `250`. */
  loadedRequestMinDuration: number;
  /** Maximum number of loaded-latency data points to retain (most recent kept). Default: `20`. */
  loadedLatencyMaxPoints: number;
}

/**
 * User-facing configuration for the speed test engine.
 *
 * A partial of {@link Config}: pass any subset to the engine constructor to
 * override individual options; omitted properties fall back to their defaults
 * in {@link defaultConfig}.
 */
export type ConfigOptions = Partial<Config>;

const REL_API_URL = 'https://speed.cloudflare.com';

const defaultConfig: Config = {
  // Engine
  autoStart: true,

  // APIs
  downloadApiUrl: `${REL_API_URL}/__down`,
  uploadApiUrl: `${REL_API_URL}/__up`,
  logMeasurementApiUrl: null,
  logAimApiUrl: 'https://aim.cloudflare.com/__log',
  turnServerUri: 'turn.speed.cloudflare.com:50000',
  turnServerCredsApiUrl: `${REL_API_URL}/turn-creds`,
  turnServerUser: null,
  turnServerPass: null,
  rpkiInvalidHost: 'invalid.rpki.cloudflare.com',
  includeCredentials: false,
  sessionId: undefined,

  // Measurements
  measurements: [
    { type: 'latency', numPackets: 1 }, // initial ttfb estimation
    { type: 'download', bytes: 1e5, count: 1, bypassMinDuration: true }, // initial download estimation
    { type: 'latency', numPackets: 20 },
    { type: 'download', bytes: 1e5, count: 9 },
    { type: 'download', bytes: 1e6, count: 8 },
    { type: 'upload', bytes: 1e5, count: 8 },
    {
      type: 'packetLoss',
      numPackets: 1e3,
      batchSize: 10,
      batchWaitTime: 10, // ms (in between batches)
      responsesWaitTime: 3000 // ms (silent time after last sent msg)
    },
    { type: 'upload', bytes: 1e6, count: 6 },
    { type: 'download', bytes: 1e7, count: 6 },
    { type: 'upload', bytes: 1e7, count: 4 },
    { type: 'download', bytes: 2.5e7, count: 4 },
    { type: 'upload', bytes: 2.5e7, count: 4 },
    { type: 'download', bytes: 1e8, count: 3 },
    { type: 'upload', bytes: 5e7, count: 3 },
    { type: 'download', bytes: 2.5e8, count: 2 }
  ],
  measureDownloadLoadedLatency: true,
  measureUploadLoadedLatency: true,
  loadedLatencyThrottle: 400, // ms in between loaded latency requests
  bandwidthFinishRequestDuration: 1000, // download/upload duration (ms) to reach for stopping further measurements of that type
  estimatedServerTime: 10, // ms to discount from latency calculation (if not present in response headers)

  // Test abort
  bandwidthAbortRequestDuration: 0, // download/upload duration (ms) to abort measurement early and stop further measurements of that type

  // Result interpretation
  latencyPercentile: 0.5, // Percentile used to calculate latency from a set of measurements
  bandwidthPercentile: 0.9, // Percentile used to calculate bandwidth from a set of measurements
  bandwidthMinRequestDuration: 10, // minimum duration (ms) to consider a measurement good enough to use in bandwidth calculation
  loadedRequestMinDuration: 250, // minimum duration (ms) of a request to consider it to be loading the connection
  loadedLatencyMaxPoints: 20 // number of data points to keep for loaded latency
};

export default defaultConfig;
