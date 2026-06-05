import type { Engine } from '../Engine';

const MAX_RETRIES = 20;

const ESTIMATED_HEADER_FRACTION = 0.005; // ~.5% of packet header / payload size. used when transferSize is not available.

/** Extract server processing time from the `Server-Timing` response header. */
const cfGetServerTime = (r: Response): number | undefined => {
  // extract server-timing from headers: server-timing: cfRequestDuration;dur=15.999794
  const serverTiming = r.headers.get(`server-timing`);
  if (serverTiming) {
    const re = serverTiming.match(/(?:^|;)\s*dur=([0-9.]+)/);
    if (re) return +re[1];
  }
};

/** Time to first byte: time from request start to first response byte (ms). */
const getTtfb = (perf: PerformanceResourceTiming): number =>
  perf.responseStart - perf.requestStart;

/** Payload download time: time from first response byte to last byte (ms). */
const getPayloadDownload = (perf: PerformanceResourceTiming): number =>
  perf.responseEnd - perf.responseStart; // min 1ms

/** Total download duration: TTFB + payload download time (ms). */
const calcDownloadDuration = ({
  ping,
  payloadDownloadTime
}: {
  ping: number;
  payloadDownloadTime: number;
}): number => ping + payloadDownloadTime; // request duration excluding server time

/** Total upload duration: server reports via TTFB (ms). */
const calcUploadDuration = ({ ttfb }: { ttfb: number }): number => ttfb;

/** Download speed in bits per second. */
const calcDownloadSpeed = (
  { duration, transferSize }: { duration: number; transferSize: number },
  numBytes: number
): number | undefined => {
  // use transferSize if available. if estimating from numBytes, add ~0.5% of headers.
  const bits =
    8 * (transferSize || +numBytes * (1 + ESTIMATED_HEADER_FRACTION));
  const secs = duration / 1000;

  return !secs ? undefined : bits / secs;
};

/** Upload speed in bits per second. */
const calcUploadSpeed = (
  { duration }: { duration: number },
  numBytes: number
): number | undefined => {
  const bits = 8 * numBytes * (1 + ESTIMATED_HEADER_FRACTION); // take into account estimated packet headers
  const secs = duration / 1000; // subtract estimated server time

  return !secs ? undefined : bits / secs;
};

const genContent = (() => {
  const cache = new Map<number, string>();
  return (numBytes: number): string => {
    if (!cache.has(numBytes)) cache.set(numBytes, '0'.repeat(numBytes));
    return cache.get(numBytes)!;
  };
})();

//

export interface BandwidthMeasurement {
  dir: 'down' | 'up';
  bytes: number;
  count: number;
  bypassMinDuration?: boolean;
}

export interface BandwidthMeasurementTiming {
  transferSize: number;
  ttfb: number;
  payloadDownloadTime: number;
  serverTime: number;
  measTime: Date;
  ping: number;
  duration: number;
  bps: number | undefined;
  /** Server-accepted upload size (bytes) from `cf-meta-upload-bytes`, uploads only. */
  uploadBytes?: number;
}

export interface BandwidthTimingResult extends BandwidthMeasurementTiming {
  type: 'down' | 'up';
  bytes: number;
}

export interface BytesResult {
  timings: BandwidthMeasurementTiming[];
  numMeasurements: number;
}

export interface BandwidthEngineResults {
  down: Record<number, BytesResult>;
  up: Record<number, BytesResult>;
}

export interface ResponseHookPayload {
  url: string;
  headers: Headers;
  body: string;
}

export interface BandwidthEngineOptions {
  downloadApiUrl?: string;
  uploadApiUrl?: string;
  throttleMs?: number;
  estimatedServerTime?: number;
}

/**
 * Measures download and upload bandwidth via sequential HTTP requests.
 * Each request's timing is extracted from the browser's PerformanceResourceTiming
 * API, providing accurate transfer duration independent of JS execution overhead.
 * Supports configurable retry logic and abort thresholds.
 */
class BandwidthMeasurementEngine implements Engine {
  constructor(
    measurements: BandwidthMeasurement[],
    {
      downloadApiUrl,
      uploadApiUrl,
      throttleMs = 0,
      estimatedServerTime = 0
    }: BandwidthEngineOptions = {}
  ) {
    if (!measurements) throw new Error('Missing measurements argument');
    if (!downloadApiUrl) throw new Error('Missing downloadApiUrl argument');
    if (!uploadApiUrl) throw new Error('Missing uploadApiUrl argument');

    this.#measurements = measurements;
    this.#downloadApi = downloadApiUrl;
    this.#uploadApi = uploadApiUrl;
    this.#throttleMs = throttleMs;
    this.#estimatedServerTime = Math.max(0, estimatedServerTime);
  }

  // Public attributes
  get results(): BandwidthEngineResults {
    // read access to results
    return this.#results;
  }

  #qsParams: Record<string, string> = {}; // additional query string params to include in the requests
  get qsParams(): Record<string, string> {
    return this.#qsParams;
  }
  set qsParams(v: Record<string, string>) {
    this.#qsParams = v;
  }

  #fetchOptions: RequestInit = {}; // additional options included in the requests
  get fetchOptions(): RequestInit {
    return this.#fetchOptions;
  }
  set fetchOptions(v: RequestInit) {
    this.#fetchOptions = v;
  }

  finishRequestDuration: number = 1000; // download/upload duration (ms) to reach for stopping further measurements
  abortRequestDuration: number = 0;
  getServerTime: ((r: Response) => number | undefined) | null = cfGetServerTime; // method to extract server time from response

  #responseHook: (r: ResponseHookPayload) => void = () => {}; // pipe-through of response objects
  set responseHook(f: (r: ResponseHookPayload) => void) {
    this.#responseHook = f;
  }

  #onRunningChange: (running: boolean) => void = () => {}; // callback invoked when engine starts/stops
  set onRunningChange(f: (running: boolean) => void) {
    this.#onRunningChange = f;
  }
  #onNewMeasurementStarted: (
    measurement: BandwidthMeasurement,
    results: BandwidthEngineResults
  ) => void = () => {}; // callback invoked when a new item in the measurement list is started
  set onNewMeasurementStarted(
    f: (
      measurement: BandwidthMeasurement,
      results: BandwidthEngineResults
    ) => void
  ) {
    this.#onNewMeasurementStarted = f;
  }
  #onMeasurementResult: (
    result: BandwidthTimingResult,
    results: BandwidthEngineResults
  ) => void = () => {}; // callback invoked when a new measurement result arrives
  set onMeasurementResult(
    f: (result: BandwidthTimingResult, results: BandwidthEngineResults) => void
  ) {
    this.#onMeasurementResult = f;
  }
  #onFinished: (results: BandwidthEngineResults) => void = () => {}; // callback invoked when all the measurements are finished
  set onFinished(f: (results: BandwidthEngineResults) => void) {
    this.#onFinished = f;
  }
  #onConnectionError: (error: string) => void = () => {}; // Invoked when unable to get a response from the API
  set onConnectionError(f: (error: string) => void) {
    this.#onConnectionError = f;
  }

  // Public methods
  pause(): void {
    this.#cancelCurrentMeasurement(`pause()`);
    this.#setRunning(false);
  }

  play(): void {
    if (!this.#running) {
      this.#setRunning(true);
      this.#nextMeasurement();
    }
  }

  // Internal state
  #measurements: BandwidthMeasurement[];
  #downloadApi: string;
  #uploadApi: string;

  #running: boolean = false;
  #finished: Record<string, boolean> = { down: false, up: false };
  #results: BandwidthEngineResults = { down: {}, up: {} };
  #measIdx: number = 0;
  #counter: number = 0;
  #retries: number = 0;
  #minDuration: number = -Infinity; // of current measurement
  #throttleMs: number = 0;
  #estimatedServerTime: number = 0;

  /**
   * Aborts the current measurement.
   */
  #currentAbortController: AbortController | undefined = undefined;

  // Internal methods
  #setRunning(running: boolean): void {
    if (running !== this.#running) {
      this.#running = running;
      setTimeout(() => this.#onRunningChange(this.#running));
    }

    if (!running) {
      this.#currentAbortController?.abort('setRunning(false)');
    }
  }

  #saveMeasurementResults(
    measIdx: number,
    measTiming?: BandwidthMeasurementTiming
  ): void {
    const { bytes, dir } = this.#measurements[measIdx];

    const results = this.#results;

    const bytesResult: BytesResult = results[dir].hasOwnProperty(bytes)
      ? results[dir][bytes]
      : {
          timings: [],
          // count all measurements with same bytes and direction
          numMeasurements: this.#measurements
            .filter(({ bytes: b, dir: d }) => bytes === b && dir === d)
            .map(m => m.count)
            .reduce((agg, cnt) => agg + cnt, 0)
        };

    !!measTiming && bytesResult.timings.push(measTiming);
    bytesResult.timings = bytesResult.timings.slice(
      -bytesResult.numMeasurements
    );

    results[dir][bytes] = bytesResult;

    if (measTiming) {
      setTimeout(() => {
        this.#onMeasurementResult(
          {
            type: dir,
            bytes,
            ...measTiming
          },
          results
        );
      });
    } else {
      this.#onNewMeasurementStarted(this.#measurements[measIdx], results);
    }
  }

  #nextMeasurement(): void {
    const measurements = this.#measurements;
    let meas = measurements[this.#measIdx];

    if (this.#counter >= meas.count) {
      // Finished current measurement
      const finished = this.#finished;
      if (
        this.#minDuration > this.finishRequestDuration &&
        !meas.bypassMinDuration
      ) {
        // mark direction as finished
        const dir = meas.dir;
        this.#finished[dir] = true;
        Object.values(this.#finished).every(finished => finished) &&
          this.#onFinished(this.#results);
      }

      // clear settings
      this.#counter = 0;
      this.#minDuration = -Infinity;
      performance.clearResourceTimings();

      do {
        this.#measIdx += 1; // skip through finished measurements
      } while (
        this.#measIdx < measurements.length &&
        finished[measurements[this.#measIdx].dir]
      );

      if (this.#measIdx >= measurements.length) {
        // reached the end: halt further measurements
        this.#finished = { down: true, up: true };
        this.#setRunning(false);
        this.#onFinished(this.#results);
        return;
      }

      meas = measurements[this.#measIdx];
    }

    const measIdx = this.#measIdx;

    if (this.#counter === 0) {
      this.#saveMeasurementResults(measIdx); // register measurement start
    }

    const { bytes: numBytes, dir } = meas;
    const isDown = dir === 'down';

    const apiUrl = isDown ? this.#downloadApi : this.#uploadApi;
    const qsParams: Record<string, string> = Object.assign({}, this.#qsParams);
    isDown && (qsParams.bytes = `${numBytes}`);

    const urlObj = new URL(apiUrl, window.location.origin);
    Object.entries(qsParams).forEach(([k, v]) => urlObj.searchParams.set(k, v));
    const url = urlObj.href;

    const fetchOpt: RequestInit = Object.assign(
      {},
      isDown
        ? {}
        : {
            method: 'POST',
            body: genContent(numBytes)
          },
      this.#fetchOptions
    );

    if (this.#retries === 0) {
      // abort existing abort controller
      this.#currentAbortController?.abort('restarting engine');

      // create new abort controller
      this.#currentAbortController = new AbortController();
      if (this.abortRequestDuration) {
        const abortTimeout = setTimeout(() => {
          const errorMessage = `${isDown ? 'Download' : 'Upload'} measurement of ${numBytes} bytes aborted. Measurement exceeded bandwidthAbortRequestDuration (${this.abortRequestDuration}ms)`;
          this.#cancelCurrentMeasurement(errorMessage);
          this.#retries = 0;
          this.#setRunning(false);
          this.#onConnectionError(errorMessage);
        }, this.abortRequestDuration);
        this.#currentAbortController.signal.addEventListener('abort', () =>
          clearTimeout(abortTimeout)
        );
      }
    }

    let serverTime: number | undefined;
    fetch(url, {
      ...fetchOpt,
      signal: this.#currentAbortController!.signal
    })
      .then(r => {
        if (r.ok) return r;
        throw Error(r.statusText);
      })
      .then(r => {
        this.getServerTime && (serverTime = this.getServerTime(r));
        return r;
      })
      .then(r =>
        r.text().then(body => {
          this.#responseHook({
            url,
            headers: r.headers,
            body
          });

          return body;
        })
      )
      .then(() => {
        const perf = performance
          .getEntriesByName(url)
          .slice(-1)[0] as PerformanceResourceTiming; // get latest perf timing
        const timing: BandwidthMeasurementTiming = {
          transferSize: perf.transferSize,
          ttfb: getTtfb(perf),
          payloadDownloadTime: getPayloadDownload(perf),
          serverTime: serverTime || -1,
          measTime: new Date(),
          ping: 0,
          duration: 0,
          bps: undefined
        };
        timing.ping = Math.max(
          1e-2,
          timing.ttfb - (serverTime || this.#estimatedServerTime)
        ); // ttfb = network latency + server time

        timing.duration = (isDown ? calcDownloadDuration : calcUploadDuration)(
          timing
        );
        timing.bps = (isDown ? calcDownloadSpeed : calcUploadSpeed)(
          timing,
          numBytes
        );

        if (isDown && numBytes) {
          const reqSize = +numBytes;
          if (
            timing.transferSize &&
            (timing.transferSize < reqSize ||
              timing.transferSize / reqSize > 1.05)
          ) {
            // log if transferSize is too different from requested size
            console.warn(
              `Requested ${reqSize}B but received ${timing.transferSize}B (${
                Math.round((timing.transferSize / reqSize) * 1e4) / 1e2
              }%).`
            );
          }
        }

        this.#saveMeasurementResults(measIdx, timing);
        const requestDuration = timing.duration;
        this.#minDuration =
          this.#minDuration < 0
            ? requestDuration
            : Math.min(this.#minDuration, requestDuration); // carry minimum request duration

        this.#counter += 1;
        this.#retries = 0;

        if (this.#throttleMs) {
          const throttleTimeout = setTimeout(
            () => this.#nextMeasurement(),
            this.#throttleMs
          );
          this.#currentAbortController!.signal.addEventListener('abort', () =>
            clearTimeout(throttleTimeout)
          );
        } else {
          this.#nextMeasurement();
        }
      })
      .catch(error => {
        if (this.#currentAbortController!.signal.aborted) {
          return;
        }
        console.warn(`Error fetching ${url}: ${error}`);

        if (this.#retries++ < MAX_RETRIES) {
          this.#nextMeasurement(); // keep trying
        } else {
          this.#retries = 0;
          this.#setRunning(false);
          this.#onConnectionError(
            `Connection failed to ${url}. Gave up after ${MAX_RETRIES} retries.`
          );
        }
      });
  }

  #cancelCurrentMeasurement(reason?: string): void {
    this.#currentAbortController?.abort(
      reason || `aborted with no reason provided`
    );
  }
}

export default BandwidthMeasurementEngine;
