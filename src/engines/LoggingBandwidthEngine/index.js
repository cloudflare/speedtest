import 'isomorphic-fetch';

import BandwidthEngine from '../BandwidthEngine';

class LoggingBandwidthEngine extends BandwidthEngine {
  constructor(measurements, { measurementId, logApiUrl, ...ptProps } = {}) {
    super(measurements, ptProps);

    this.#measurementId = measurementId;
    this.#logApiUrl = logApiUrl;

    super.qsParams = logApiUrl ? { measId: this.#measurementId } : {};
    super.responseHook = r => this.#loggingResponseHook(r);
    super.onMeasurementResult = meas => this.#logMeasurement(meas);
  }

  // Overridden attributes
  set qsParams(qsParams) {
    super.qsParams = this.#logApiUrl
      ? { measId: this.#measurementId, ...qsParams }
      : qsParams;
  }

  set responseHook(responseHook) {
    super.responseHook = r => {
      responseHook(r);
      this.#loggingResponseHook(r);
    };
  }

  set onMeasurementResult(onMeasurementResult) {
    super.onMeasurementResult = (meas, ...restArgs) => {
      onMeasurementResult(meas, ...restArgs);
      this.#logMeasurement(meas);
    };
  }

  // Internal state
  #measurementId;
  #token;
  #requestTime;
  #logApiUrl;

  // Internal methods
  #loggingResponseHook(r) {
    if (!this.#logApiUrl) return;

    // get request time
    this.#requestTime = +r.headers.get(`cf-meta-request-time`);

    // get token in payload
    this.#token = r.body.slice(-300).split('___').pop();
  }

  #logMeasurement(measData) {
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
      measId: this.#measurementId
    };

    this.#token = null;
    this.#requestTime = null;

    // eslint-disable-next-line compat/compat
    fetch(this.#logApiUrl, {
      method: 'POST',
      body: JSON.stringify(logData),
      ...this.fetchOptions
    });
  }
}

export default LoggingBandwidthEngine;
