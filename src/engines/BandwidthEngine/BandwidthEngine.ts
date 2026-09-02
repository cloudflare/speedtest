import type { Engine } from '../Engine';
import {
  withAuthorizationHeader,
  type AuthorizationOptions
} from '../../utils/authorization';

const MAX_RETRIES = 20;

const ESTIMATED_HEADER_FRACTION = 0.005; // ~.5% of packet header / payload size. used when transferSize is not available.

const SERVER_TIME_MIN_DURATION = 0.01; // minimum server-provided duration value to consider valid (ms)
const SERVER_TIME_DELTA_MAX = 15; // max server time delta to accept (ms)
const SERVER_TIME_CALIBRATION_MAX = 150; // max server time for delta calibration (ms)
const SERVER_TIME_DELTA_WEIGHT = 0.75; // weight of new delta observations (0-1), blended with previous value

// extract the server time from server-timing header(s)
const cfGetServerTime = (r: Response): number | undefined => {
  const serverTiming = r.headers.get(`server-timing`);
  if (!serverTiming) return;

  const re = serverTiming.match(
    /(?:^|,\s*)cfReq(?:uest)?Dur(?:ation)?;\s*dur=([0-9.]+)/i
  );
  if (re && +re[1] > SERVER_TIME_MIN_DURATION) return +re[1];

  let sum = 0;
  for (const m of serverTiming.matchAll(
    /(?:^|,\s*)cfSpeed[a-zA-Z]*;\s*dur=([0-9.]+)/gi
  )) {
    sum += +m[1];
  }
  if (sum > SERVER_TIME_MIN_DURATION) return sum;
  return undefined;
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

interface TimeInterval {
  start: number;
  end: number;
}

const getCoveredDuration = (
  intervals: TimeInterval[],
  rangeStart: number,
  rangeEnd: number
): number => {
  const clipped = intervals
    .map(({ start, end }) => ({
      start: Math.max(start, rangeStart),
      end: Math.min(end, rangeEnd)
    }))
    .filter(({ start, end }) => end > start)
    .sort((a, b) => a.start - b.start);
  let covered = 0;
  let currentEnd = rangeStart;
  clipped.forEach(({ start, end }) => {
    if (end <= currentEnd) return;
    covered += end - Math.max(start, currentEnd);
    currentEnd = end;
  });
  return covered;
};

export const aggregateRequestTimings = (
  timings: RequestTiming[],
  isDown: boolean,
  numBytes: number,
  pausedIntervals: TimeInterval[] = []
): BandwidthMeasurementTiming => {
  if (timings.length === 1) return timings[0];

  const requestStart = Math.min(...timings.map(timing => timing.requestStart));
  const responseStart = Math.min(
    ...timings.map(timing => timing.responseStart)
  );
  const responseEnd = Math.max(...timings.map(timing => timing.responseEnd));
  const intervalEnd = isDown
    ? responseEnd
    : Math.max(...timings.map(timing => timing.responseStart));
  const serverIntervals = isDown
    ? timings.map(timing => {
        const rawDuration = timing.responseEnd - timing.requestStart;
        const adjustment = Math.min(
          Math.max(0, rawDuration - timing.duration),
          timing.responseStart - timing.requestStart
        );
        return {
          start: timing.responseStart - adjustment,
          end: timing.responseStart
        };
      })
    : [];
  const duration =
    intervalEnd -
    requestStart -
    getCoveredDuration(
      [...serverIntervals, ...pausedIntervals],
      requestStart,
      intervalEnd
    );
  const transferSize = timings.reduce(
    (total, timing) => total + timing.transferSize,
    0
  );
  const transferredBytes = numBytes * timings.length;
  const effectiveTransferSize = timings.reduce(
    (total, timing) =>
      total +
      (timing.transferSize || numBytes * (1 + ESTIMATED_HEADER_FRACTION)),
    0
  );
  const serverTimes = timings
    .map(timing => timing.serverTime)
    .filter(serverTime => serverTime >= 0);

  return {
    transferSize,
    transferredBytes,
    ttfb: responseStart - requestStart,
    payloadDownloadTime: isDown ? duration : 0,
    serverTime: serverTimes.length
      ? serverTimes.reduce((total, serverTime) => total + serverTime, 0) /
        serverTimes.length
      : -1,
    measTime: new Date(),
    ping: Math.min(...timings.map(timing => timing.ping)),
    duration,
    bps: isDown
      ? calcDownloadSpeed(
          { duration, transferSize: effectiveTransferSize },
          transferredBytes
        )
      : calcUploadSpeed({ duration }, transferredBytes)
  };
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
  transferredBytes?: number;
}

export interface RequestTiming extends BandwidthMeasurementTiming {
  requestStart: number;
  responseStart: number;
  responseEnd: number;
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
  downloadApiUrls?: string[];
  uploadApiUrls?: string[];
  getDownloadApiUrl?: () => string;
  getUploadApiUrl?: () => string;
  parallel?: boolean;
  throttleMs?: number;
  estimatedServerTime?: number;
  serverTimeDelta?: number;
  authorization?: AuthorizationOptions | null;
}

/**
 * Measures download and upload bandwidth via configurable HTTP requests.
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
      downloadApiUrls,
      uploadApiUrls,
      getDownloadApiUrl,
      getUploadApiUrl,
      parallel = false,
      throttleMs = 0,
      estimatedServerTime = 0,
      serverTimeDelta = 0,
      authorization = null
    }: BandwidthEngineOptions = {}
  ) {
    if (!measurements) throw new Error('Missing measurements argument');
    if (!downloadApiUrl && !downloadApiUrls?.length && !getDownloadApiUrl) {
      throw new Error('Missing download API URL argument');
    }
    if (!uploadApiUrl && !uploadApiUrls?.length && !getUploadApiUrl) {
      throw new Error('Missing upload API URL argument');
    }

    this.#measurements = measurements;
    this.#downloadApis = downloadApiUrls?.length
      ? downloadApiUrls
      : [downloadApiUrl!];
    this.#uploadApis = uploadApiUrls?.length ? uploadApiUrls : [uploadApiUrl!];
    this.#getDownloadApiUrl =
      getDownloadApiUrl ?? (() => this.#downloadApis[0]);
    this.#getUploadApiUrl = getUploadApiUrl ?? (() => this.#uploadApis[0]);
    this.#parallel = parallel;
    this.#throttleMs = throttleMs;
    this.#estimatedServerTime = Math.max(0, estimatedServerTime);
    this.#serverTimeDelta = Math.max(0, serverTimeDelta);
    this.#authorization = authorization;
  }

  // Public attributes
  get results(): BandwidthEngineResults {
    // read access to results
    return this.#results;
  }

  get serverTimeDelta(): number {
    return this.#serverTimeDelta;
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
  #onRequestResult: (result: BandwidthTimingResult) => void = () => {};
  set onRequestResult(f: (result: BandwidthTimingResult) => void) {
    this.#onRequestResult = f;
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
    if (this.#parallel && this.#running && this.#pauseStartedAt === undefined) {
      this.#pauseStartedAt = performance.now();
    }
    this.#cancelCurrentMeasurement(`pause()`);
    this.#setRunning(false);
  }

  play(): void {
    if (!this.#running) {
      if (this.#pauseStartedAt !== undefined) {
        this.#pausedIntervals.push({
          start: this.#pauseStartedAt,
          end: performance.now()
        });
        this.#pauseStartedAt = undefined;
      }
      this.#setRunning(true);
      this.#nextMeasurement();
    }
  }

  // Internal state
  #measurements: BandwidthMeasurement[];
  #downloadApis: string[];
  #uploadApis: string[];
  #getDownloadApiUrl: () => string;
  #getUploadApiUrl: () => string;
  #parallel: boolean;

  #running: boolean = false;
  #finished: Record<string, boolean> = { down: false, up: false };
  #results: BandwidthEngineResults = { down: {}, up: {} };
  #measIdx: number = 0;
  #counter: number = 0;
  #requestId: number = 0;
  #parallelTimings: RequestTiming[] = [];
  #pausedIntervals: TimeInterval[] = [];
  #pauseStartedAt: number | undefined;
  #minDuration: number = -Infinity; // of current measurement
  #throttleMs: number = 0;
  #estimatedServerTime: number = 0;
  #serverTimeDelta: number = 0;
  #authorization: AuthorizationOptions | null = null;

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
          // Parallel steps produce one logical result for all physical requests.
          numMeasurements: this.#measurements
            .filter(({ bytes: b, dir: d }) => bytes === b && dir === d)
            .map(m => (this.#parallel ? 1 : m.count))
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
      this.#onNewMeasurementStarted(
        {
          ...this.#measurements[measIdx],
          count: this.#parallel ? 1 : this.#measurements[measIdx].count
        },
        results
      );
    }
  }

  #nextMeasurement(): void {
    this.#runNextMeasurement().catch(error => {
      this.#setRunning(false);
      this.#onConnectionError(String(error));
    });
  }

  async #runNextMeasurement(): Promise<void> {
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
      this.#parallelTimings = [];
      this.#pausedIntervals = [];
      this.#pauseStartedAt = undefined;
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

    this.#currentAbortController?.abort('restarting engine');
    this.#currentAbortController = new AbortController();
    const abortController = this.#currentAbortController;

    try {
      let timing: BandwidthMeasurementTiming;
      if (this.#parallel) {
        const timings = await this.#runParallelPool(
          meas,
          isDown,
          abortController
        );
        if (abortController.signal.aborted) return;
        timing = aggregateRequestTimings(
          timings,
          isDown,
          numBytes,
          this.#pausedIntervals
        );
        this.#counter = meas.count;
        this.#minDuration = Math.min(...timings.map(timing => timing.duration));
      } else {
        const apiUrl = isDown
          ? this.#getDownloadApiUrl()
          : this.#getUploadApiUrl();
        timing = await this.#fetchMeasurement(
          apiUrl,
          numBytes,
          isDown,
          abortController,
          `${this.#measIdx}-${this.#requestId++}`
        );
        if (abortController.signal.aborted) return;
        this.#counter += 1;
        this.#minDuration =
          this.#minDuration < 0
            ? timing.duration
            : Math.min(this.#minDuration, timing.duration);
      }

      this.#saveMeasurementResults(measIdx, timing);

      if (this.#throttleMs) {
        const throttleTimeout = setTimeout(
          () => this.#nextMeasurement(),
          this.#throttleMs
        );
        abortController.signal.addEventListener('abort', () =>
          clearTimeout(throttleTimeout)
        );
      } else {
        this.#nextMeasurement();
      }
    } catch (error) {
      if (abortController.signal.aborted) return;
      this.#setRunning(false);
      this.#onConnectionError(String(error));
    }
  }

  async #runParallelPool(
    measurement: BandwidthMeasurement,
    isDown: boolean,
    abortController: AbortController
  ): Promise<RequestTiming[]> {
    const configuredApis = isDown ? this.#downloadApis : this.#uploadApis;
    const apis = configuredApis.length
      ? configuredApis
      : [isDown ? this.#getDownloadApiUrl() : this.#getUploadApiUrl()];
    let nextRequest = this.#parallelTimings.length;
    const runLane = async (apiUrl: string): Promise<void> => {
      while (
        !abortController.signal.aborted &&
        this.#currentAbortController === abortController &&
        nextRequest < measurement.count
      ) {
        const requestId = `${this.#measIdx}-${this.#requestId++}`;
        nextRequest += 1;
        await this.#fetchMeasurement(
          apiUrl,
          measurement.bytes,
          isDown,
          abortController,
          requestId,
          completedTiming => {
            if (this.#currentAbortController !== abortController) return false;
            this.#parallelTimings.push(completedTiming);
            return true;
          }
        );
        if (
          abortController.signal.aborted ||
          this.#currentAbortController !== abortController
        ) {
          return;
        }
      }
    };

    await Promise.all(
      apis.slice(0, measurement.count).map(apiUrl => runLane(apiUrl))
    );
    return this.#parallelTimings;
  }

  async #fetchMeasurement(
    apiUrl: string,
    numBytes: number,
    isDown: boolean,
    abortController: AbortController,
    requestId: string,
    recordCompletion?: (timing: RequestTiming) => boolean
  ): Promise<RequestTiming> {
    if (abortController.signal.aborted) {
      throw new Error(String(abortController.signal.reason));
    }

    const qsParams: Record<string, string> = {
      ...this.#qsParams,
      bytes: `${numBytes}`,
      ...(this.#parallel && {
        __cf_speedtest_request: requestId
      })
    };
    const urlObj = new URL(apiUrl, window.location.origin);
    Object.entries(qsParams).forEach(([key, value]) =>
      urlObj.searchParams.set(key, value)
    );
    const url = urlObj.href;
    const fetchOptions = withAuthorizationHeader(
      {
        ...(isDown ? {} : { method: 'POST', body: genContent(numBytes) }),
        ...this.#fetchOptions
      },
      this.#authorization,
      url
    );

    const requestController = new AbortController();
    const abortRequest = () =>
      requestController.abort(abortController.signal.reason);
    abortController.signal.addEventListener('abort', abortRequest, {
      once: true
    });
    const timeoutMessage = `${isDown ? 'Download' : 'Upload'} measurement of ${numBytes} bytes aborted. Measurement exceeded bandwidthAbortRequestDuration (${this.abortRequestDuration}ms)`;
    const abortTimeout = this.abortRequestDuration
      ? setTimeout(
          () => requestController.abort(timeoutMessage),
          this.abortRequestDuration
        )
      : undefined;

    try {
      let lastError: unknown;
      for (let retry = 0; retry <= MAX_RETRIES; retry += 1) {
        try {
          const timing = await this.#performFetch(
            url,
            fetchOptions,
            numBytes,
            isDown,
            qsParams,
            requestController.signal
          );
          if (recordCompletion && !recordCompletion(timing)) return timing;
          this.#onRequestResult({
            type: isDown ? 'down' : 'up',
            bytes: numBytes,
            ...timing
          });
          return timing;
        } catch (error) {
          if (requestController.signal.aborted) {
            throw new Error(
              typeof requestController.signal.reason === 'string'
                ? requestController.signal.reason
                : String(error)
            );
          }
          lastError = error;
          console.warn(`Error fetching ${url}: ${error}`);
        }
      }

      throw new Error(
        `Connection failed to ${url}. Gave up after ${MAX_RETRIES} retries: ${lastError}`
      );
    } finally {
      clearTimeout(abortTimeout);
      abortController.signal.removeEventListener('abort', abortRequest);
    }
  }

  async #performFetch(
    url: string,
    fetchOptions: RequestInit,
    numBytes: number,
    isDown: boolean,
    qsParams: Record<string, string>,
    signal: AbortSignal
  ): Promise<RequestTiming> {
    const response = await fetch(url, { ...fetchOptions, signal });
    if (!response.ok) throw Error(response.statusText);

    const serverTime = this.getServerTime?.(response);
    const body = await response.text();
    this.#responseHook({ url, headers: response.headers, body });

    const perf = performance.getEntriesByName(url).slice(-1)[0] as
      | PerformanceResourceTiming
      | undefined;
    if (!perf) throw new Error(`Missing resource timing for ${url}`);

    const timing: RequestTiming = {
      transferSize: perf.transferSize,
      ttfb: getTtfb(perf),
      payloadDownloadTime: getPayloadDownload(perf),
      serverTime: serverTime || -1,
      measTime: new Date(),
      ping: 0,
      duration: 0,
      bps: undefined,
      requestStart: perf.requestStart,
      responseStart: perf.responseStart,
      responseEnd: perf.responseEnd
    };

    let connectTime = 0;
    if (perf.secureConnectionStart > perf.connectStart) {
      connectTime = perf.secureConnectionStart - perf.connectStart;
    } else {
      connectTime = perf.connectEnd - perf.connectStart;
    }
    const protoMatch = perf.nextHopProtocol.match(/([0-9.]+)/);
    const httpVersion = protoMatch ? +protoMatch[1] : 0;
    if (serverTime && connectTime && httpVersion > 0 && httpVersion < 2) {
      const derivedTotalServerTime = Math.max(0, timing.ttfb - connectTime);
      const delta = derivedTotalServerTime - serverTime;
      if (
        delta > 0 &&
        delta <= SERVER_TIME_DELTA_MAX &&
        delta <= serverTime &&
        serverTime <= SERVER_TIME_CALIBRATION_MAX
      ) {
        this.#serverTimeDelta =
          this.#serverTimeDelta * (1 - SERVER_TIME_DELTA_WEIGHT) +
          delta * SERVER_TIME_DELTA_WEIGHT;
        console.log(
          `serverTimeDelta (estimated): ${this.#serverTimeDelta.toFixed(2)}ms`
        );
      } else if (delta > 0) {
        console.log(`serverTimeDelta (skipped): ${delta.toFixed(2)}ms`);
      }
    }

    const baseServerTime = serverTime || this.#estimatedServerTime;
    timing.ping = timing.ttfb - baseServerTime - this.#serverTimeDelta;
    if (timing.ping <= 1) {
      timing.ping = Math.max(0, timing.ttfb - baseServerTime);
    }
    timing.duration = (isDown ? calcDownloadDuration : calcUploadDuration)(
      timing
    );
    timing.bps = (isDown ? calcDownloadSpeed : calcUploadSpeed)(
      timing,
      numBytes
    );

    const delta = this.#serverTimeDelta;
    if (numBytes === 0) {
      console.log('latency', {
        phase: `during ${qsParams.during || 'idle'}`,
        ttfb: timing.ttfb,
        serverTime: baseServerTime,
        ...(delta && { serverTimeDelta: delta }),
        ping: timing.ping
      });
    } else {
      console.log(isDown ? 'download' : 'upload', {
        bytes: numBytes,
        bps: timing.bps,
        ttfb: timing.ttfb,
        serverTime: baseServerTime,
        ...(delta && { serverTimeDelta: delta }),
        ping: timing.ping
      });
    }

    if (
      isDown &&
      numBytes &&
      timing.transferSize &&
      (timing.transferSize < numBytes || timing.transferSize / numBytes > 1.05)
    ) {
      console.warn(
        `Requested ${numBytes}B but received ${timing.transferSize}B (${
          Math.round((timing.transferSize / numBytes) * 1e4) / 1e2
        }%).`
      );
    }

    return timing;
  }

  #cancelCurrentMeasurement(reason?: string): void {
    this.#currentAbortController?.abort(
      reason || `aborted with no reason provided`
    );
  }
}

export { cfGetServerTime };
export default BandwidthMeasurementEngine;
