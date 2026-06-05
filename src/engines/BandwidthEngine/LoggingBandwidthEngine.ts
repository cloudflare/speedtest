import BandwidthEngine from '.';
import type {
  BandwidthMeasurement,
  BandwidthTimingResult,
  BandwidthEngineResults,
  ResponseHookPayload
} from './BandwidthEngine';
import type { ParallelLatencyOptions } from './ParallelLatency';

export const parseUploadBytesHeader = (
  headers: Headers
): number | undefined => {
  const value = headers.get('cf-meta-upload-bytes');
  if (!value || !/^\d+$/.test(value)) return undefined;

  const bytes = Number(value);
  return Number.isSafeInteger(bytes) ? bytes : undefined;
};

/** Upload logs use server-accepted bytes when the server reports a cap. */
export const getLoggedBytes = (
  measData: Pick<BandwidthTimingResult, 'type' | 'bytes'>,
  uploadBytes: number | undefined
): number =>
  measData.type === 'up' && uploadBytes !== undefined
    ? uploadBytes
    : measData.bytes;

export interface LoggingBandwidthEngineOptions extends ParallelLatencyOptions {
  measurementId?: string;
  logApiUrl?: string;
  sessionId?: string;
}

/**
 * Extends BandwidthWithParallelLatencyEngine to log individual measurement
 * results to a remote endpoint. Each completed HTTP request triggers a POST
 * with timing metadata (TTFB, duration, server time) and an optional
 * authentication token extracted from the response body.
 */
class LoggingBandwidthEngine extends BandwidthEngine {
  constructor(
    measurements: BandwidthMeasurement[],
    {
      measurementId,
      logApiUrl,
      sessionId,
      ...ptProps
    }: LoggingBandwidthEngineOptions = {}
  ) {
    super(measurements, ptProps);

    this.#measurementId = measurementId;
    this.#logApiUrl = logApiUrl;
    this.#sessionId = sessionId;

    super.qsParams = logApiUrl ? { measId: this.#measurementId! } : {};
    super.responseHook = (r: ResponseHookPayload) =>
      this.#loggingResponseHook(r);
    super.onMeasurementResult = (meas: BandwidthTimingResult) => {
      this.#applyUploadBytes(meas);
      this.#logMeasurement(meas);
    };
  }

  // Overridden attributes
  set qsParams(qsParams: Record<string, string>) {
    super.qsParams = this.#logApiUrl
      ? { measId: this.#measurementId!, ...qsParams }
      : qsParams;
  }

  set responseHook(responseHook: (r: ResponseHookPayload) => void) {
    super.responseHook = (r: ResponseHookPayload) => {
      responseHook(r);
      this.#loggingResponseHook(r);
    };
  }

  set onMeasurementResult(
    onMeasurementResult: (
      meas: BandwidthTimingResult,
      results: BandwidthEngineResults
    ) => void
  ) {
    super.onMeasurementResult = (
      meas: BandwidthTimingResult,
      ...restArgs: [BandwidthEngineResults]
    ) => {
      this.#applyUploadBytes(meas);
      onMeasurementResult(meas, ...restArgs);
      this.#logMeasurement(meas);
    };
  }

  // Internal state
  #measurementId: string | undefined;
  #token: string | null | undefined;
  #requestTime: number | null | undefined;
  #uploadBytes: number | undefined;
  #logApiUrl: string | undefined;
  #sessionId: string | undefined;

  // Internal methods

  /**
   * Records server-accepted upload bytes on the measurement result so the
   * final results payload can report the actual uploaded size (uploads only).
   */
  #applyUploadBytes(measData: BandwidthTimingResult): void {
    if (measData.type === 'up' && this.#uploadBytes !== undefined) {
      measData.uploadBytes = this.#uploadBytes;
    }
  }

  #loggingResponseHook(r: ResponseHookPayload): void {
    // Capture server-accepted upload bytes regardless of per-measurement
    // logging, so the final results payload can report actual uploaded sizes.
    this.#uploadBytes = parseUploadBytesHeader(r.headers);

    if (!this.#logApiUrl) return;

    // get request time
    this.#requestTime = +r.headers.get(`cf-meta-request-time`)!;

    // get token in payload
    this.#token = r.body.slice(-300).split('___').pop();
  }

  #logMeasurement(measData: BandwidthTimingResult): void {
    if (!this.#logApiUrl) return;

    const logData = {
      type: measData.type,
      bytes: getLoggedBytes(measData, this.#uploadBytes),
      ping: Math.round(measData.ping), // round to ms
      ttfb: Math.round(measData.ttfb), // round to ms
      payloadDownloadTime: Math.round(measData.payloadDownloadTime),
      duration: Math.round(measData.duration),
      transferSize: Math.round(measData.transferSize),
      serverTime: Math.round(measData.serverTime),
      token: this.#token,
      requestTime: this.#requestTime,
      measId: this.#measurementId,
      sessionId: this.#sessionId
    };

    this.#token = null;
    this.#requestTime = null;
    this.#uploadBytes = undefined;

    fetch(this.#logApiUrl, {
      method: 'POST',
      body: JSON.stringify(logData),
      ...this.fetchOptions
    });
  }
}

export default LoggingBandwidthEngine;
