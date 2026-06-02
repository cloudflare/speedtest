interface LoadEngineConfig {
  apiUrl: string;
  qsParams?: Record<string, string>;
  fetchOptions?: RequestInit;
}

/**
 * Internal engine that continuously runs a promise-returning function in a
 * loop. Each iteration waits for the previous promise to resolve before
 * starting the next. Supports play/pause lifecycle via a cancellation flag.
 */
class PromiseEngine {
  constructor(promiseFn: () => Promise<void>) {
    if (!promiseFn) throw new Error(`Missing operation to perform`);

    this.#promiseFn = promiseFn;
    this.play();
  }

  // Public methods
  pause(): void {
    this.#cancelCurrent();
    this.#setRunning(false);
  }

  stop(): void {
    this.pause();
  }

  play(): void {
    if (!this.#running) {
      this.#setRunning(true);
      this.#next();
    }
  }

  // Internal state
  #running: boolean = false;
  #currentPromise: (Promise<void> & { _cancel?: boolean }) | undefined =
    undefined;
  #promiseFn: () => Promise<void>;

  // Internal methods
  #setRunning(running: boolean): void {
    if (running !== this.#running) {
      this.#running = running;
    }
  }

  #next(): void {
    const curPromise: Promise<void> & { _cancel?: boolean } =
      (this.#currentPromise = this.#promiseFn().then(() => {
        !curPromise._cancel && this.#next();
      }));
  }

  #cancelCurrent(): void {
    const curPromise = this.#currentPromise;
    curPromise && (curPromise._cancel = true);
  }
}

export interface LoadNetworkDownloadConfig {
  apiUrl: string;
  chunkSize: number;
}

export interface LoadNetworkUploadConfig {
  apiUrl: string;
  chunkSize: number;
}

export interface LoadNetworkEngineOptions {
  download?: LoadNetworkDownloadConfig | null;
  upload?: LoadNetworkUploadConfig | null;
}

/**
 * Generates sustained network load by running parallel download and/or upload
 * fetch loops. Used as a sub-engine by bandwidth-under-load and packet-loss
 * engines to saturate the connection during measurements.
 */
class LoadNetworkEngine {
  constructor({ download, upload }: LoadNetworkEngineOptions = {}) {
    // Expected attrs for each: { apiUrl, chunkSize }
    if (!download && !upload)
      throw new Error('Missing at least one of download/upload config');

    const configs: [
      LoadNetworkDownloadConfig | LoadNetworkUploadConfig | null | undefined,
      string
    ][] = [
      [download, 'download'],
      [upload, 'upload']
    ];

    configs
      .filter(
        (
          entry
        ): entry is [
          LoadNetworkDownloadConfig | LoadNetworkUploadConfig,
          string
        ] => entry[0] !== null && entry[0] !== undefined
      )
      .forEach(([cfg, type]) => {
        const { apiUrl, chunkSize } = cfg;
        if (!apiUrl) throw new Error(`Missing ${type} apiUrl argument`);
        if (!chunkSize) throw new Error(`Missing ${type} chunkSize argument`);
      });

    const getLoadEngine = ({
      apiUrl,
      qsParams = {},
      fetchOptions = {}
    }: LoadEngineConfig): PromiseEngine =>
      new PromiseEngine(() => {
        const fetchQsParams: Record<string, string> = Object.assign(
          {},
          qsParams,
          this.qsParams
        );
        const urlObj = new URL(apiUrl, window.location.origin);
        Object.entries(fetchQsParams).forEach(([k, v]) =>
          urlObj.searchParams.set(k, v)
        );
        const url = urlObj.href;
        const fetchOpt: RequestInit = Object.assign(
          {},
          fetchOptions,
          this.fetchOptions
        );

        return fetch(url, fetchOpt)
          .then(r => {
            if (r.ok) return r;
            throw Error(r.statusText);
          })
          .then(r => r.text()) as Promise<void>;
      });

    download &&
      this.#engines.push(
        getLoadEngine({
          apiUrl: download.apiUrl,
          qsParams: { bytes: `${download.chunkSize}` }
        })
      );

    upload &&
      this.#engines.push(
        getLoadEngine({
          apiUrl: upload.apiUrl,
          fetchOptions: {
            method: 'POST',
            body: '0'.repeat(upload.chunkSize)
          }
        })
      );
  }

  // Public attributes
  qsParams: Record<string, string> = {}; // additional query string params to include in the requests
  fetchOptions: RequestInit = {}; // additional options included in the requests

  // Public methods
  pause(): void {
    this.#engines.forEach(engine => engine.pause());
  }

  stop(): void {
    this.pause();
  }

  play(): void {
    this.#engines.forEach(engine => engine.play());
  }

  // Internal state
  #engines: PromiseEngine[] = [];
}

export default LoadNetworkEngine;
