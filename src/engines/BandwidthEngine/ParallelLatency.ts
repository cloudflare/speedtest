import BandwidthEngine from './BandwidthEngine';
import type {
  BandwidthMeasurement,
  BandwidthEngineOptions,
  BandwidthTimingResult
} from './BandwidthEngine';

export interface ParallelLatencyOptions extends BandwidthEngineOptions {
  measureParallelLatency?: boolean;
  parallelLatencyThrottleMs?: number;
}

/**
 * Extends BandwidthEngine to measure latency in parallel during bandwidth tests.
 * Runs a lightweight side-channel engine that sends zero-byte requests at a
 * configurable interval, collecting round-trip times while the main engine
 * saturates the connection with download or upload traffic.
 */
class BandwidthWithParallelLatencyEngine extends BandwidthEngine {
  constructor(
    measurements: BandwidthMeasurement[],
    {
      measureParallelLatency = false,
      parallelLatencyThrottleMs = 100,
      downloadApiUrl,
      uploadApiUrl,
      estimatedServerTime = 0,
      ...ptProps
    }: ParallelLatencyOptions = {}
  ) {
    super(measurements, {
      downloadApiUrl,
      uploadApiUrl,
      estimatedServerTime,
      ...ptProps
    });

    if (measureParallelLatency) {
      this.#latencyEngine = new BandwidthEngine(
        [
          {
            dir: 'down',
            bytes: 0,
            count: Infinity,
            bypassMinDuration: true
          }
        ],
        {
          downloadApiUrl,
          uploadApiUrl,
          estimatedServerTime,
          throttleMs: parallelLatencyThrottleMs
        }
      );
      this.#latencyEngine.qsParams = {
        during: `${measurements[0].dir}load`
      };

      super.onRunningChange = this.#setLatencyRunning;
      super.onConnectionError = () => this.#latencyEngine!.pause();
    }
  }

  // Public attributes
  get latencyResults() {
    // read access to latency results
    return this.#latencyEngine && this.#latencyEngine.results.down[0].timings;
  }

  // callback invoked when a new parallel latency result arrives
  set onParallelLatencyResult(f: (res: BandwidthTimingResult) => void) {
    this.#latencyEngine &&
      (this.#latencyEngine.onMeasurementResult = (res: BandwidthTimingResult) =>
        f(res));
  }

  // Overridden attributes
  get fetchOptions(): RequestInit {
    return super.fetchOptions;
  }
  set fetchOptions(fetchOptions: RequestInit) {
    super.fetchOptions = fetchOptions;
    this.#latencyEngine && (this.#latencyEngine.fetchOptions = fetchOptions);
  }

  set onRunningChange(onRunningChange: (running: boolean) => void) {
    super.onRunningChange = (running: boolean) => {
      this.#setLatencyRunning(running);
      onRunningChange(running);
    };
  }

  set onConnectionError(onConnectionError: (error: string) => void) {
    super.onConnectionError = (...args: [string]) => {
      this.#latencyEngine && this.#latencyEngine.pause();
      onConnectionError(...args);
    };
  }

  // Internal state
  #latencyEngine: BandwidthEngine | undefined;
  #latencyTimeout: ReturnType<typeof setTimeout> | undefined;

  // Internal methods
  #setLatencyRunning = (running: boolean): void => {
    if (this.#latencyEngine) {
      if (!running) {
        clearTimeout(this.#latencyTimeout);
        this.#latencyEngine.pause();
      } else {
        // slight delay in starting latency measurements
        this.#latencyTimeout = setTimeout(
          () => this.#latencyEngine!.play(),
          20
        );
      }
    }
  };
}

export default BandwidthWithParallelLatencyEngine;
