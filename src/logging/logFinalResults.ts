import type Results from '../Results';
import type { BandwidthPoint } from '../types';

/** Subset of PacketLossResults used for logging (includes error case). */
interface PacketLossDetails {
  /** Number of messages actually sent during the test. */
  numMessagesSent: number;
  /** Packet loss ratio (0–1). */
  packetLoss: number;
  /** Error message if the packet loss measurement failed. */
  error?: string;
  [key: string]: unknown;
}

/** A single AIM experience score entry for logging. */
interface ScoreEntry {
  /** Aggregate point total. */
  points: number;
  /** Human-readable classification (bad/poor/average/good/great). */
  classificationName: string;
}

/** Configuration for the AIM results logging endpoint. */
interface LogConfig {
  /** URL to POST the results to. */
  apiUrl: string;
  /** Session ID to include in the log payload. */
  sessionId: string | undefined;
}

/** Payload structure sent to the AIM logging endpoint. */
interface LogData {
  /** Session ID correlating all measurements in this test run. */
  sessionId: string | undefined;
  /** AIM experience scores (streaming, gaming, rtc). */
  scores?: Record<string, { points: number; classification: string }>;
  [key: string]: unknown;
}

type ParserFn = (val: unknown) => unknown;

/** Rounds a number to a given number of decimal places. */
const round = (
  num: number | undefined,
  decimals: number = 0
): number | undefined =>
  !num ? num : Math.round(num * 10 ** decimals) / 10 ** decimals;

/** Rounds each latency duration to 2 decimal places. */
const latencyPointsParser: ParserFn = durations =>
  (durations as number[]).map(d => round(d, 2));

/**
 * Extracts bytes and rounded bps from each bandwidth data point. For uploads,
 * `bytes` is the server-accepted size (`cf-meta-upload-bytes`) when reported,
 * falling back to the requested size; downloads always use the requested size.
 */
const bpsPointsParser: ParserFn = pnts =>
  (pnts as BandwidthPoint[]).map(d => ({
    bytes: d.uploadBytes ?? +d.bytes,
    bps: round(d.bps)
  }));

/** Converts packet loss details to a log-friendly shape, or `undefined` on error. */
const packetLossParser: ParserFn = d => {
  const details = d as PacketLossDetails;
  return details.error
    ? undefined
    : {
        numMessages: details.numMessagesSent,
        lossRatio: round(details.packetLoss, 4)
      };
};

/** Maps log field names to Results getter names and optional value parsers. */
const resultsParsers: Record<string, [string] | [string, ParserFn]> = {
  latencyMs: ['getUnloadedLatencyPoints', latencyPointsParser],
  download: ['getDownloadBandwidthPoints', bpsPointsParser],
  upload: ['getUploadBandwidthPoints', bpsPointsParser],
  downLoadedLatencyMs: ['getDownLoadedLatencyPoints', latencyPointsParser],
  upLoadedLatencyMs: ['getUpLoadedLatencyPoints', latencyPointsParser],
  packetLoss: ['getPacketLossDetails', packetLossParser],
  totalDurationMs: ['getTotalDurationMs']
  // v4Reachability: ['getV4ReachabilityDetails'],
  // v6Reachability: ['getV6ReachabilityDetails']
};

/** Normalises a ScoreEntry into the shape expected by the logging endpoint. */
const scoreParser = (
  d: ScoreEntry
): { points: number; classification: string } => ({
  points: d.points,
  classification: d.classificationName
});

/**
 * Formats measurement results and AIM scores, then POSTs them to the
 * AIM logging endpoint. Fire-and-forget — errors are silently ignored.
 */
const logAimResults = (
  results: Results,
  { apiUrl, sessionId }: LogConfig
): void => {
  const logData: LogData = {
    sessionId
  };
  Object.entries(resultsParsers).forEach(([logK, [fn, parser]]) => {
    const resolvedParser: ParserFn = parser ?? ((d: unknown) => d);
    const val = (results as unknown as Record<string, () => unknown>)[fn]();
    if (val) {
      logData[logK] = resolvedParser(val);
    }
  });

  const scores = results.getScores();
  if (scores) {
    logData.scores = Object.assign(
      {},
      ...Object.entries(scores).map(([k, score]) => ({
        [k]: scoreParser(score)
      }))
    );
  }

  fetch(apiUrl, {
    method: 'POST',
    body: JSON.stringify(logData)
  });
};

export default logAimResults;
