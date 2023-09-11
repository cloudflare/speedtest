import BandwidthEngine from './BandwidthEngine';

class BandwidthWithParallelLatencyEngine extends BandwidthEngine {
  constructor(
    measurements,
    {
      measureParallelLatency = false,
      parallelLatencyThrottleMs = 100,
      downloadApiUrl,
      uploadApiUrl,
      estimatedServerTime = 0,
      ...ptProps
    } = {}
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
      super.onConnectionError = () => this.#latencyEngine.pause();
    }
  }

  // Public attributes
  get latencyResults() {
    // read access to latency results
    return this.#latencyEngine && this.#latencyEngine.results.down[0].timings;
  }

  // callback invoked when a new parallel latency result arrives
  set onParallelLatencyResult(f) {
    this.#latencyEngine &&
      (this.#latencyEngine.onMeasurementResult = res => f(res));
  }

  // Overridden attributes
  get fetchOptions() {
    return super.fetchOptions;
  }
  set fetchOptions(fetchOptions) {
    super.fetchOptions = fetchOptions;
    this.#latencyEngine && (this.#latencyEngine.fetchOptions = fetchOptions);
  }

  set onRunningChange(onRunningChange) {
    super.onRunningChange = running => {
      this.#setLatencyRunning(running);
      onRunningChange(running);
    };
  }

  set onConnectionError(onConnectionError) {
    super.onConnectionError = (...args) => {
      this.#latencyEngine && this.#latencyEngine.pause();
      onConnectionError(...args);
    };
  }

  // Internal state
  #latencyEngine;

  // Internal methods
  #setLatencyRunning(running) {
    this.#latencyEngine &&
      (!running
        ? this.#latencyEngine.pause()
        : // slight delay in starting latency measurements
          setTimeout(() => this.#latencyEngine.play(), 20));
  }
}

export default BandwidthWithParallelLatencyEngine;
