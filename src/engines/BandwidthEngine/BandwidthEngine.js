import 'isomorphic-fetch';

import memoize from 'lodash.memoize';

const MAX_RETRIES = 20;

const ESTIMATED_HEADER_FRACTION = 0.005; // ~.5% of packet header / payload size. used when transferSize is not available.

const cfGetServerTime = r => {
  // extract server-timing from headers: server-timing: cfRequestDuration;dur=15.999794
  const serverTiming = r.headers.get(`server-timing`);
  if (serverTiming) {
    const re = serverTiming.match(/dur=([0-9.]+)/);
    if (re) return +re[1];
  }
};

const getTtfb = perf => perf.responseStart - perf.requestStart;

const gePayloadDownload = perf => perf.responseEnd - perf.responseStart; // min 1ms

const calcDownloadDuration = ({ ping, payloadDownloadTime }) =>
  ping + payloadDownloadTime; // request duration excluding server time

const calcUploadDuration = ({ ttfb }) => ttfb;

const calcDownloadSpeed = ({ duration, transferSize }, numBytes) => {
  // use transferSize if available. if estimating from numBytes, add ~0.5% of headers.
  const bits =
    8 * (transferSize || +numBytes * (1 + ESTIMATED_HEADER_FRACTION));
  const secs = duration / 1000;

  return !secs ? undefined : bits / secs;
};

const calcUploadSpeed = ({ duration }, numBytes) => {
  const bits = 8 * numBytes * (1 + ESTIMATED_HEADER_FRACTION); // take into account estimated packet headers
  const secs = duration / 1000; // subtract estimated server time

  return !secs ? undefined : bits / secs;
};

const genContent = memoize(numBytes => '0'.repeat(numBytes));

//

class BandwidthMeasurementEngine {
  constructor(
    measurements,
    {
      downloadApiUrl,
      uploadApiUrl,
      throttleMs = 0,
      estimatedServerTime = 0
    } = {}
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
  get results() {
    // read access to results
    return this.#results;
  }

  #qsParams = {}; // additional query string params to include in the requests
  get qsParams() {
    return this.#qsParams;
  }
  set qsParams(v) {
    this.#qsParams = v;
  }

  #fetchOptions = {}; // additional options included in the requests
  get fetchOptions() {
    return this.#fetchOptions;
  }
  set fetchOptions(v) {
    this.#fetchOptions = v;
  }

  finishRequestDuration = 1000; // download/upload duration (ms) to reach for stopping further measurements
  getServerTime = cfGetServerTime; // method to extract server time from response

  #responseHook = r => r; // pipe-through of response objects
  set responseHook(f) {
    this.#responseHook = f;
  }

  #onRunningChange = () => {}; // callback invoked when engine starts/stops
  set onRunningChange(f) {
    this.#onRunningChange = f;
  }
  #onNewMeasurementStarted = () => {}; // callback invoked when a new item in the measurement list is started
  set onNewMeasurementStarted(f) {
    this.#onNewMeasurementStarted = f;
  }
  #onMeasurementResult = () => {}; // callback invoked when a new measurement result arrives
  set onMeasurementResult(f) {
    this.#onMeasurementResult = f;
  }
  #onFinished = () => {}; // callback invoked when all the measurements are finished
  set onFinished(f) {
    this.#onFinished = f;
  }
  #onConnectionError = () => {}; // Invoked when unable to get a response from the API
  set onConnectionError(f) {
    this.#onConnectionError = f;
  }

  // Public methods
  pause() {
    clearTimeout(this.#currentNextMsmTimeoutId);
    this.#cancelCurrentMeasurement();
    this.#setRunning(false);
  }

  play() {
    if (!this.#running) {
      this.#setRunning(true);
      this.#nextMeasurement();
    }
  }

  // Internal state
  #measurements;
  #downloadApi;
  #uploadApi;

  #running = false;
  #finished = { down: false, up: false };
  #results = { down: {}, up: {} };
  #measIdx = 0;
  #counter = 0;
  #retries = 0;
  #minDuration = -Infinity; // of current measurement
  #throttleMs = 0;
  #estimatedServerTime = 0;
  #currentFetchPromise = undefined;
  #currentNextMsmTimeoutId = undefined;

  // Internal methods
  #setRunning(running) {
    if (running !== this.#running) {
      this.#running = running;
      setTimeout(() => this.#onRunningChange(this.#running));
    }
  }

  #saveMeasurementResults(measIdx, measTiming) {
    const { bytes, dir } = this.#measurements[measIdx];

    const results = this.#results;

    const bytesResult = results[dir].hasOwnProperty(bytes)
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

  #nextMeasurement() {
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
    const qsParams = Object.assign({}, this.#qsParams);
    isDown && (qsParams.bytes = `${numBytes}`);

    const url = `${
      apiUrl.startsWith('http') || apiUrl.startsWith('//')
        ? ''
        : window.location.origin // use abs to match perf timing urls
    }${apiUrl}?${Object.entries(qsParams)
      .map(([k, v]) => `${k}=${v}`)
      .join('&')}`;

    const fetchOpt = Object.assign(
      {},
      isDown
        ? {}
        : {
            method: 'POST',
            body: genContent(numBytes)
          },
      this.#fetchOptions
    );

    let serverTime;
    const curPromise = (this.#currentFetchPromise = fetch(url, fetchOpt) // eslint-disable-line compat/compat
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
          this.#responseHook &&
            this.#responseHook({
              url,
              headers: r.headers,
              body
            });

          return body;
        })
      )
      .then((_, reject) => {
        if (curPromise._cancel) {
          reject('cancelled');
          return;
        }

        const perf = performance.getEntriesByName(url).slice(-1)[0]; // get latest perf timing
        const timing = {
          transferSize: perf.transferSize,
          ttfb: getTtfb(perf),
          payloadDownloadTime: gePayloadDownload(perf),
          serverTime: serverTime || -1,
          measTime: new Date()
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
          this.#currentNextMsmTimeoutId = setTimeout(
            () => this.#nextMeasurement(),
            this.#throttleMs
          );
        } else {
          this.#nextMeasurement();
        }
      })
      .catch(error => {
        if (curPromise._cancel) return;
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
      }));
  }

  #cancelCurrentMeasurement() {
    const curPromise = this.#currentFetchPromise;
    curPromise && (curPromise._cancel = true);
  }
}

export default BandwidthMeasurementEngine;
