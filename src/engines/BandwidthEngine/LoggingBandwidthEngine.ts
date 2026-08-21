import BandwidthEngine from '.';
import type {
  BandwidthMeasurement,
  BandwidthTimingResult,
  BandwidthEngineResults,
  ResponseHookPayload
} from './BandwidthEngine';
import type { ParallelLatencyOptions } from './ParallelLatency';
import {
  withAuthorizationHeader,
  type AuthorizationOptions
} from '../../utils/authorization';

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
      authorization,
      ...ptProps
    }: LoggingBandwidthEngineOptions = {}
  ) {
    // Destructured out of `ptProps`, so it has to be passed back explicitly.
    super(measurements, { ...ptProps, authorization });

    this.#measurementId = measurementId;
    this.#logApiUrl = logApiUrl;
    this.#sessionId = sessionId;
    this.#authorization = authorization ?? null;

    super.qsParams = logApiUrl ? { measId: this.#measurementId! } : {};
    super.responseHook = (r: ResponseHookPayload) =>
      this.#loggingResponseHook(r);
    super.onMeasurementResult = (meas: BandwidthTimingResult) =>
      this.#logMeasurement(meas);
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
      onMeasurementResult(meas, ...restArgs);
      this.#logMeasurement(meas);
    };
  }

  // Internal state
  #measurementId: string | undefined;
  #token: string | null | undefined;
  #requestTime: number | null | undefined;
  #logApiUrl: string | undefined;
  #sessionId: string | undefined;
  #authorization: AuthorizationOptions | null;

  // Internal methods
  #loggingResponseHook(r: ResponseHookPayload): void {
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
      bytes: measData.bytes,
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

    // Swallowed: a failed log must not fail the measurement it describes.
    fetch(
      this.#logApiUrl,
      // Resolved against the log URL, not the measurement URL the inherited
      // fetchOptions were built for — the two may not share a scheme.
      withAuthorizationHeader(
        {
          method: 'POST',
          body: JSON.stringify(logData),
          ...this.fetchOptions
        },
        this.#authorization,
        this.#logApiUrl
      )
    ).catch(() => {});
  }
}

export default LoggingBandwidthEngine;
