import BandwidthEngine from '.';
import type {
  BandwidthMeasurement,
  BandwidthTimingResult,
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
 * results to a remote endpoint. Each completed HTTP request, including each
 * request of a parallel batch, triggers a POST with its own timing metadata
 * (TTFB, duration, server time) and the token from its response body.
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
    super.onRequestResult = (
      meas: BandwidthTimingResult,
      response: ResponseHookPayload
    ) => this.#logMeasurement(meas, response);
  }

  // Overridden attributes
  set qsParams(qsParams: Record<string, string>) {
    super.qsParams = this.#logApiUrl
      ? { measId: this.#measurementId!, ...qsParams }
      : qsParams;
  }

  // Internal state
  #measurementId: string | undefined;
  #logApiUrl: string | undefined;
  #sessionId: string | undefined;
  #authorization: AuthorizationOptions | null;

  // Internal methods
  #logMeasurement(
    measData: BandwidthTimingResult,
    response: ResponseHookPayload
  ): void {
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
      // The token and request time of the response this measurement timed
      token: response.body.slice(-300).split('___').pop(),
      requestTime: +response.headers.get(`cf-meta-request-time`)!,
      measId: this.#measurementId,
      sessionId: this.#sessionId
    };

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
