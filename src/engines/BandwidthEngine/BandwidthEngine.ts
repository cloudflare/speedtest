import type { Engine } from '../Engine';
import {
  withAuthorizationHeader,
  type AuthorizationOptions
} from '../../utils/authorization';

const MAX_RETRIES = 3;

class HttpError extends Error {
  constructor(
    readonly status: number,
    statusText: string,
    readonly retryAfter: string | null
  ) {
    super(statusText);
  }
}

const getRetryDelay = (retryAfter: string | null): number => {
  if (!retryAfter) return 5000;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const date = Date.parse(retryAfter);
  return Number.isNaN(date) ? 5000 : Math.max(0, date - Date.now());
};

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

/** Resource Timing Level 3 fields not yet in TypeScript's DOM lib. */
export type InterimAwareTiming = PerformanceResourceTiming & {
  finalResponseHeadersStart?: number;
  firstInterimResponseStart?: number;
};

/**
 * Start of the final response (ms). `responseStart` marks the first response,
 * which may be an interim 1xx. Falls back to it where the final timestamp is
 * unsupported, or zeroed for cross-origin requests without Timing-Allow-Origin.
 */
export const getFinalResponseStart = (perf: InterimAwareTiming): number =>
  perf.finalResponseHeadersStart || perf.responseStart;

/** Missing resource timing entries in a row before giving up on a set. */
const MAX_MISSING_ENTRIES = 3;

/** Entries for `url` from requests started at or after `since`. */
const getRequestEntries = (url: string, since: number) =>
  performance
    .getEntriesByName(url)
    .filter(entry => entry.startTime >= since) as PerformanceResourceTiming[];

/**
 * Whether an entry has detailed timings. Browsers zero them for cross-origin
 * responses without `Timing-Allow-Origin`, which would make the duration the
 * time since page load.
 */
const hasDetailedTiming = (
  perf: Pick<PerformanceResourceTiming, 'requestStart' | 'responseStart'>
): boolean => perf.requestStart !== 0 || perf.responseStart !== 0;

/** Time to first byte: time from request start to the final response (ms). */
const getTtfb = (perf: PerformanceResourceTiming): number =>
  getFinalResponseStart(perf) - perf.requestStart;

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

/**
 * Whether a sample can be stored. Transfers need a finite, positive speed,
 * which is missing when the browser reports a zero or negative request
 * duration. Latency samples (zero bytes) only use `ping`, so they are always
 * kept.
 */
export const hasUsableSpeed = (
  { bps }: Pick<BandwidthMeasurementTiming, 'bps'>,
  numBytes: number
): boolean =>
  +numBytes === 0 ||
  (typeof bps === 'number' && Number.isFinite(bps) && bps > 0);

const genContent = (() => {
  const cache = new Map<number, string>();
  return (numBytes: number): string => {
    if (!cache.has(numBytes)) cache.set(numBytes, '0'.repeat(numBytes));
    return cache.get(numBytes)!;
  };
})();

/** Bytes kept from the end of a response, which carries its token. */
const BODY_TAIL_BYTES = 1024;

/**
 * Reads a response to the end, keeping only its tail as text, so downloads
 * don't hold their whole payloads in memory.
 */
const readBodyTail = async (r: Response): Promise<string> => {
  if (!r.body) return '';
  const reader = r.body.getReader();
  let tail = new Uint8Array(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value.length >= BODY_TAIL_BYTES) {
      tail = value.slice(-BODY_TAIL_BYTES);
    } else {
      const merged = new Uint8Array(tail.length + value.length);
      merged.set(tail);
      merged.set(value, tail.length);
      tail = merged.slice(-BODY_TAIL_BYTES);
    }
  }
  return new TextDecoder().decode(tail);
};

//

export interface BandwidthMeasurement {
  dir: 'down' | 'up';
  bytes: number;
  /** Number of samples. Each sample is one batch of `parallel` requests. */
  count: number;
  bypassMinDuration?: boolean;
  /** Concurrent requests per sample. Default: `1`. */
  parallel?: number;
}

/** Concurrent requests per sample, as a positive integer. Invalid values are `1`. */
export const getParallelism = ({
  parallel
}: Pick<BandwidthMeasurement, 'parallel'>): number =>
  typeof parallel === 'number' && Number.isFinite(parallel) && parallel >= 1
    ? Math.floor(parallel)
    : 1;

/** Bytes one sample transfers: the payload of every request in its batch. */
export const getSampleBytes = (
  meas: Pick<BandwidthMeasurement, 'bytes' | 'parallel'>
): number => meas.bytes * getParallelism(meas);

/** One request of a sample: its resource timing and server time. */
export interface BatchRequestTiming {
  perf: Pick<
    InterimAwareTiming,
    | 'requestStart'
    | 'responseStart'
    | 'responseEnd'
    | 'transferSize'
    | 'finalResponseHeadersStart'
  >;
  serverTime?: number;
}

/**
 * Times a sample of one or more concurrent requests, as if it were a single
 * request spanning the first request start to the last completion. Downloads
 * exclude server time (the smallest of the batch, as that much is certain to
 * overlap), and uploads end at the last final response.
 */
export const aggregateBatchTiming = (
  requests: BatchRequestTiming[],
  {
    isDown,
    numBytes,
    estimatedServerTime = 0,
    serverTimeDelta = 0
  }: {
    isDown: boolean;
    numBytes: number;
    estimatedServerTime?: number;
    serverTimeDelta?: number;
  }
): BandwidthMeasurementTiming => {
  const perRequest = requests.map(({ perf, serverTime }) => {
    const finalStart = getFinalResponseStart(perf as InterimAwareTiming);
    const ttfb = finalStart - perf.requestStart;
    const baseServerTime = serverTime || estimatedServerTime;
    let ping = ttfb - baseServerTime - serverTimeDelta;
    if (ping <= 1) ping = Math.max(0, ttfb - baseServerTime);
    return { ttfb, ping, serverAdjustment: ttfb - ping, finalStart };
  });

  const start = Math.min(...requests.map(({ perf }) => perf.requestStart));
  const lastResponseEnd = Math.max(
    ...requests.map(({ perf }) => perf.responseEnd)
  );
  const lastFinalStart = Math.max(...perRequest.map(r => r.finalStart));
  const ping = Math.min(...perRequest.map(r => r.ping));
  const duration = isDown
    ? lastResponseEnd -
      start -
      Math.min(...perRequest.map(r => r.serverAdjustment))
    : lastFinalStart - start;

  // A missing size on any request makes the speed fall back to an estimate
  const transferSize = requests.every(({ perf }) => perf.transferSize)
    ? requests.reduce((sum, { perf }) => sum + perf.transferSize, 0)
    : 0;
  const serverTimes = requests
    .map(({ serverTime }) => serverTime)
    .filter((t): t is number => !!t);
  const totalBytes = numBytes * requests.length;

  return {
    transferSize,
    ttfb: Math.min(...perRequest.map(r => r.ttfb)),
    payloadDownloadTime: isDown
      ? Math.max(0, duration - ping)
      : Math.max(0, lastResponseEnd - lastFinalStart),
    serverTime: serverTimes.length ? Math.min(...serverTimes) : -1,
    measTime: new Date(),
    ping,
    duration,
    bps: isDown
      ? calcDownloadSpeed({ duration, transferSize }, totalBytes)
      : calcUploadSpeed({ duration }, totalBytes)
  };
};

export interface BandwidthMeasurementTiming {
  transferSize: number;
  ttfb: number;
  payloadDownloadTime: number;
  serverTime: number;
  measTime: Date;
  ping: number;
  duration: number;
  bps: number | undefined;
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
  /** One URL, or several to round-robin requests across. */
  downloadApiUrl?: string | string[];
  /** One URL, or several to round-robin requests across. */
  uploadApiUrl?: string | string[];
  throttleMs?: number;
  estimatedServerTime?: number;
  serverTimeDelta?: number;
  authorization?: AuthorizationOptions | null;
}

const toUrlList = (url: string | string[] | undefined): string[] =>
  (Array.isArray(url) ? url : [url]).filter((u): u is string => !!u);

/**
 * Measures download and upload bandwidth via HTTP requests, run one at a time
 * or, for measurements with `parallel` > 1, in concurrent batches. Each
 * request's timing is extracted from the browser's PerformanceResourceTiming
 * API, providing accurate transfer duration independent of JS execution overhead.
 * Requests round-robin across the API URLs, from a random starting URL.
 * Supports configurable retry logic and abort thresholds.
 */
class BandwidthMeasurementEngine implements Engine {
  constructor(
    measurements: BandwidthMeasurement[],
    {
      downloadApiUrl,
      uploadApiUrl,
      throttleMs = 0,
      estimatedServerTime = 0,
      serverTimeDelta = 0,
      authorization = null
    }: BandwidthEngineOptions = {}
  ) {
    if (!measurements) throw new Error('Missing measurements argument');
    const downloadApis = toUrlList(downloadApiUrl);
    const uploadApis = toUrlList(uploadApiUrl);
    if (!downloadApis.length)
      throw new Error('Missing downloadApiUrl argument');
    if (!uploadApis.length) throw new Error('Missing uploadApiUrl argument');

    this.#measurements = measurements;
    this.#apis = { down: downloadApis, up: uploadApis };
    this.#apiIdx = {
      down: Math.floor(Math.random() * downloadApis.length),
      up: Math.floor(Math.random() * uploadApis.length)
    };
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
  #abortRequestDuration: number = 0; // request duration (ms) after which a request is aborted and skipped
  get abortRequestDuration(): number {
    return this.#abortRequestDuration;
  }
  set abortRequestDuration(v: number) {
    this.#abortRequestDuration = v;
  }
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
    results: BandwidthEngineResults,
    measurement: BandwidthMeasurement
  ) => void = () => {}; // callback invoked when a new measurement result arrives
  set onMeasurementResult(
    f: (
      result: BandwidthTimingResult,
      results: BandwidthEngineResults,
      measurement: BandwidthMeasurement
    ) => void
  ) {
    this.#onMeasurementResult = f;
  }
  #onFinished: (results: BandwidthEngineResults) => void = () => {}; // callback invoked when all the measurements are finished
  set onFinished(f: (results: BandwidthEngineResults) => void) {
    this.#onFinished = f;
  }
  #onConnectionError: (error: string, status?: number) => void = () => {}; // Invoked when unable to get a response from the API
  set onConnectionError(f: (error: string, status?: number) => void) {
    this.#onConnectionError = f;
  }
  #onFatalError: (error: string) => void = () => {}; // Invoked when the engine can't measure at all, after pausing itself
  set onFatalError(f: (error: string) => void) {
    this.#onFatalError = f;
  }

  // Public methods
  pause(): void {
    if (this.#retryTimeout !== undefined) {
      clearTimeout(this.#retryTimeout);
      this.#retryTimeout = undefined;
    }
    clearTimeout(this.#abortTimeout);
    clearTimeout(this.#throttleTimeout);
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
  #apis: Record<'down' | 'up', string[]>;
  #apiIdx: Record<'down' | 'up', number>;

  #running: boolean = false;
  #finished: Record<string, boolean> = { down: false, up: false };
  #results: BandwidthEngineResults = { down: {}, up: {} };
  #measIdx: number = 0;
  #counter: number = 0;
  #retries: number = 0;
  #missingEntries: number = 0;
  #retryTimeout: ReturnType<typeof setTimeout> | undefined;
  #abortTimeout: ReturnType<typeof setTimeout> | undefined;
  #throttleTimeout: ReturnType<typeof setTimeout> | undefined;
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
    const meas = this.#measurements[measIdx];
    const { dir } = meas;
    // Parallel samples are keyed by the bytes of their whole batch
    const bytes = getSampleBytes(meas);

    const results = this.#results;

    const bytesResult: BytesResult = results[dir].hasOwnProperty(bytes)
      ? results[dir][bytes]
      : {
          timings: [],
          // count all measurements with same bytes and direction
          numMeasurements: this.#measurements
            .filter(m => getSampleBytes(m) === bytes && m.dir === dir)
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
          results,
          meas
        );
      });
    } else {
      this.#onNewMeasurementStarted({ ...meas, bytes }, results);
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
      this.#missingEntries = 0;
      this.#minDuration = -Infinity;

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

    this.#runSample(meas, measIdx);
  }

  /**
   * Runs one sample: a single request, or a batch of `parallel` concurrent
   * requests timed as one. A failed request voids its whole batch.
   */
  #runSample(meas: BandwidthMeasurement, measIdx: number): void {
    const { bytes: numBytes, dir } = meas;
    const isDown = dir === 'down';
    const parallel = getParallelism(meas);

    const requests = Array.from({ length: parallel }, (_, i) =>
      // Distinct URLs, so each request's resource timing entry can be told apart
      this.#buildRequest(dir, numBytes, parallel > 1 ? { req: `${i}` } : {})
    );
    const { signal: setSignal } = this.#prepareAbortController(
      parallel > 1
        ? `${isDown ? 'Download' : 'Upload'} batch of ${parallel}x${numBytes} bytes`
        : `${isDown ? 'Download' : 'Upload'} request of ${numBytes} bytes`
    );
    // A failed request aborts only its batch, so retries keep the set's abort timer
    const batchController = new AbortController();
    const abortBatch = () => batchController.abort(setSignal.reason);
    if (setSignal.aborted) abortBatch();
    else setSignal.addEventListener('abort', abortBatch, { once: true });
    const signal = batchController.signal;
    const requestedAt = performance.now();

    Promise.all(
      requests.map(({ url, fetchOpt }) =>
        fetch(url, { ...fetchOpt, signal })
          .then(r => {
            if (r.ok) return r;
            throw new HttpError(
              r.status,
              r.statusText,
              r.headers.get('retry-after')
            );
          })
          .then(async r => {
            const serverTime = this.getServerTime?.(r) ?? undefined;
            this.#responseHook({
              url,
              headers: r.headers,
              body: await readBodyTail(r)
            });
            return serverTime;
          })
          .catch(error => {
            if (!signal.aborted) {
              batchController.abort('batch request failed');
              this.#handleRequestError(error, url);
            }
            throw error;
          })
      )
    )
      .then(async serverTimes => {
        // Every request in a set shares its URL, so skip earlier requests' entries
        const findEntries = () =>
          requests.map(({ url }) => getRequestEntries(url, requestedAt));
        let entries = findEntries();
        if (entries.some(found => !found.length)) {
          // An entry can land a task after the body resolves, so look once more
          await new Promise(resolve => setTimeout(resolve));
          entries = findEntries();
        }
        if (signal.aborted) return;

        const missingIdx = entries.findIndex(found => !found.length);
        if (missingIdx >= 0) {
          this.#discardMissingEntry(dir, requests[missingIdx].url);
          return;
        }
        const perfs = entries.map(([perf]) => perf);
        const restrictedIdx = perfs.findIndex(perf => !hasDetailedTiming(perf));
        if (restrictedIdx >= 0) {
          const message = `No detailed resource timing for ${requests[restrictedIdx].url}. A cross-origin target must send a Timing-Allow-Origin header.`;
          console.warn(message);
          this.#skipFailedRequest(message);
          return;
        }
        this.#missingEntries = 0;

        const batch = perfs.map((perf, i) => {
          this.#calibrateServerTimeDelta(perf, serverTimes[i]);
          isDown && this.#warnSizeMismatch(perf.transferSize, numBytes);
          return { perf, serverTime: serverTimes[i] };
        });
        const delta = this.#serverTimeDelta;
        const timing = aggregateBatchTiming(batch, {
          isDown,
          numBytes,
          estimatedServerTime: this.#estimatedServerTime,
          serverTimeDelta: delta
        });

        const serverTime =
          timing.serverTime > 0 ? timing.serverTime : this.#estimatedServerTime;
        if (+numBytes === 0) {
          console.log('latency', {
            phase: `during ${requests[0].qsParams.during || 'idle'}`,
            ttfb: timing.ttfb,
            serverTime,
            ...(delta && { serverTimeDelta: delta }),
            ping: timing.ping
          });
        } else {
          console.log(isDown ? 'download' : 'upload', {
            bytes: numBytes * parallel,
            ...(parallel > 1 && { parallel }),
            bps: timing.bps,
            ttfb: timing.ttfb,
            serverTime,
            ...(delta && { serverTimeDelta: delta }),
            ping: timing.ping
          });
        }

        const [perf] = perfs;
        this.#recordSample(
          measIdx,
          timing,
          parallel > 1
            ? { parallel }
            : {
                perf: {
                  startTime: perf.startTime,
                  requestStart: perf.requestStart,
                  responseStart: perf.responseStart,
                  firstInterimResponseStart: (perf as InterimAwareTiming)
                    .firstInterimResponseStart,
                  finalResponseHeadersStart: (perf as InterimAwareTiming)
                    .finalResponseHeadersStart,
                  responseEnd: perf.responseEnd,
                  nextHopProtocol: perf.nextHopProtocol,
                  entries: entries[0].length
                }
              }
        );

        this.#scheduleNextMeasurement();
      })
      .catch(error => {
        // Failed requests abort the batch once handled, so this is anything else
        if (!signal.aborted) this.#handleRequestError(error, requests[0].url);
      })
      .finally(() => setSignal.removeEventListener('abort', abortBatch));
  }

  /**
   * Stores a sample and tracks the set's shortest duration, returning whether
   * it was stored. Samples without a speed are counted but not stored or
   * retried, so they can't skew results.
   */
  #recordSample(
    measIdx: number,
    timing: BandwidthMeasurementTiming,
    debug: Record<string, unknown>
  ): boolean {
    const meas = this.#measurements[measIdx];
    const bytes = getSampleBytes(meas);
    if (!hasUsableSpeed(timing, bytes)) {
      console.warn(`Discarding ${meas.dir} sample without a speed`, {
        bytes,
        ...timing,
        ...debug
      });
      return false;
    }
    this.#saveMeasurementResults(measIdx, timing);
    this.#minDuration =
      this.#minDuration < 0
        ? timing.duration
        : Math.min(this.#minDuration, timing.duration);
    return true;
  }

  /** Skips a sample whose resource timing entry is missing. */
  #discardMissingEntry(dir: 'down' | 'up', url: string): void {
    // A full or cleared buffer, or a runtime that doesn't record entries
    console.warn(`Discarding ${dir} sample without a resource timing entry`, {
      url
    });
    if (++this.#missingEntries >= MAX_MISSING_ENTRIES) {
      this.pause();
      this.#onFatalError(
        `No resource timing entries for ${url}. The host page may be clearing or filling the buffer, or the runtime doesn't record resource timing.`
      );
      return;
    }
    this.#scheduleNextMeasurement();
  }

  /** Refines serverTimeDelta from requests on new HTTP/1.1 connections. */
  #calibrateServerTimeDelta(
    perf: PerformanceResourceTiming,
    serverTime: number | undefined
  ): void {
    // Detect new TCP connection from handshake timings.
    const connectTime =
      perf.secureConnectionStart > perf.connectStart
        ? perf.secureConnectionStart - perf.connectStart
        : perf.connectEnd - perf.connectStart;

    const protoMatch = perf.nextHopProtocol.match(/([0-9.]+)/);
    const httpVersion = protoMatch ? +protoMatch[1] : 0;

    if (!serverTime || !connectTime || httpVersion <= 0 || httpVersion >= 2) {
      return;
    }
    const derivedTotalServerTime = Math.max(0, getTtfb(perf) - connectTime);
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

  /** Warns when a download's size is too different from the requested size. */
  #warnSizeMismatch(transferSize: number, numBytes: number): void {
    if (
      numBytes &&
      transferSize &&
      (transferSize < numBytes || transferSize / numBytes > 1.05)
    ) {
      console.warn(
        `Requested ${numBytes}B but received ${transferSize}B (${
          Math.round((transferSize / numBytes) * 1e4) / 1e2
        }%).`
      );
    }
  }

  /** Next API URL for `dir`, round-robin. */
  #nextApiUrl(dir: 'down' | 'up'): string {
    const apis = this.#apis[dir];
    const url = apis[this.#apiIdx[dir] % apis.length];
    this.#apiIdx[dir] += 1;
    return url;
  }

  #buildRequest(
    dir: 'down' | 'up',
    numBytes: number,
    extraParams: Record<string, string> = {}
  ): { url: string; qsParams: Record<string, string>; fetchOpt: RequestInit } {
    const qsParams: Record<string, string> = {
      ...this.#qsParams,
      ...extraParams,
      bytes: `${numBytes}`
    };

    const urlObj = new URL(this.#nextApiUrl(dir), window.location.origin);
    Object.entries(qsParams).forEach(([k, v]) => urlObj.searchParams.set(k, v));
    const url = urlObj.href;

    const fetchOpt: RequestInit = withAuthorizationHeader(
      Object.assign(
        {},
        dir === 'down'
          ? {}
          : {
              method: 'POST',
              body: genContent(numBytes)
            },
        this.#fetchOptions
      ),
      this.#authorization,
      url
    );

    return { url, qsParams, fetchOpt };
  }

  /**
   * Returns the controller for the next request, keeping the current one
   * while retrying, and arms the abort timer for `description`.
   */
  #prepareAbortController(description: string): AbortController {
    if (
      this.#retries === 0 ||
      !this.#currentAbortController ||
      this.#currentAbortController.signal.aborted
    ) {
      // abort existing abort controller
      this.#currentAbortController?.abort('restarting engine');
      clearTimeout(this.#abortTimeout);

      // create new abort controller
      const controller = (this.#currentAbortController = new AbortController());
      if (this.abortRequestDuration) {
        this.#abortTimeout = setTimeout(() => {
          const errorMessage = `${description} aborted. Request exceeded abortRequestDuration (${this.abortRequestDuration}ms)`;
          controller.abort(errorMessage);
          this.#skipFailedRequest(errorMessage);
        }, this.abortRequestDuration);
      }
    }
    return this.#currentAbortController;
  }

  #handleRequestError(error: unknown, url: string): void {
    console.warn(`Error fetching ${url}: ${error}`);

    if (
      error instanceof HttpError &&
      error.status === 429 &&
      this.#retries++ < MAX_RETRIES
    ) {
      this.#retryTimeout = setTimeout(() => {
        this.#retryTimeout = undefined;
        if (this.#running) this.#nextMeasurement();
      }, getRetryDelay(error.retryAfter));
      return;
    }

    const status = error instanceof HttpError ? error.status : undefined;
    const message =
      status === 429
        ? `Connection failed to ${url}. Gave up after ${MAX_RETRIES} retries.`
        : status === undefined
          ? `Connection failed to ${url}.`
          : `Request failed with ${status}: ${url}`;
    this.#skipFailedRequest(message, status);
  }

  // Reports a failed request and moves on, so one failure can't end the set
  #skipFailedRequest(message: string, status?: number): void {
    // An abort can land during a 429 backoff; its retry must not run too
    clearTimeout(this.#retryTimeout);
    this.#retryTimeout = undefined;
    this.#retries = 0;
    this.#onConnectionError(message, status);
    this.#running && this.#scheduleNextMeasurement();
  }

  #scheduleNextMeasurement(): void {
    // The request has settled, so its abort timer must not fire during the throttle
    clearTimeout(this.#abortTimeout);
    this.#counter += 1;
    this.#retries = 0;

    if (this.#throttleMs) {
      // Cleared by pause(): the controller may already be aborted, so its
      // abort event can't cancel this
      this.#throttleTimeout = setTimeout(() => {
        this.#throttleTimeout = undefined;
        if (this.#running) this.#nextMeasurement();
      }, this.#throttleMs);
    } else {
      this.#nextMeasurement();
    }
  }

  #cancelCurrentMeasurement(reason?: string): void {
    this.#currentAbortController?.abort(
      reason || `aborted with no reason provided`
    );
  }
}

export { cfGetServerTime };
export default BandwidthMeasurementEngine;
