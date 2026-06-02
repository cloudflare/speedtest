import {
  defaultConfig,
  internalConfig,
  type ConfigOptions,
  type InternalConfig
} from './config';
import { type Engine } from './engines/Engine';
import BandwidthEngine from './engines/BandwidthEngine/LoggingBandwidthEngine';
import PacketLossEngine from './engines/PacketLossEngine';
import ReachabilityEngine from './engines/ReachabilityEngine';

import Results from './Results';
import logFinalResults from './logging/logFinalResults';

const DEFAULT_OPTIMAL_DOWNLOAD_SIZE = 1e6;
const DEFAULT_OPTIMAL_UPLOAD_SIZE = 1e6;
const OPTIMAL_SIZE_RATIO = 0.5; // of largest size reached in measurement

/** All measurement types the engine can encounter at runtime. */
type MeasurementType =
  | 'latency'
  | 'latencyUnderLoad'
  | 'download'
  | 'upload'
  | 'packetLoss'
  | 'packetLossUnderLoad'
  | 'v4Reachability'
  | 'v6Reachability'
  | 'rpki'
  | 'nxdomain';

/**
 * A single measurement step configuration. The exact properties depend on
 * `type`, but in the switch statement we destructure dynamically so we use a
 * loose shape that captures every property any branch may need.
 */
interface MeasurementStep {
  /** Measurement type to execute (e.g., 'latency', 'download', 'packetLoss'). */
  type: MeasurementType;
  /** Number of latency pings to send (latency/latencyUnderLoad types). */
  numPackets?: number;
  /** Payload size per request in bytes (download/upload types). */
  bytes?: number;
  /** Number of requests to issue at this payload size (download/upload types). */
  count?: number;
  /** Skip the minimum-duration filter for this round (download/upload types). */
  bypassMinDuration?: boolean;
  /** Number of packets sent per batch (packetLoss types). */
  batchSize?: number;
  /** Delay between batches in ms (packetLoss types). */
  batchWaitTime?: number;
  /** Time to wait for outstanding responses after the last batch in ms (packetLoss types). */
  responsesWaitTime?: number;
  /** WebRTC connection setup timeout in ms (packetLoss types). */
  connectionTimeout?: number;
  /** Whether to generate download load during the measurement. */
  loadDown?: boolean;
  /** Whether to generate upload load during the measurement. */
  loadUp?: boolean;
  /** Target hostname for reachability probes. */
  host?: string;
  /** Target hostname for NXDOMAIN checks. */
  nxhost?: string;
  [key: string]: unknown;
}

/** The merged config object (defaultConfig + userConfig + internalConfig). */
type SpeedTestConfig = ConfigOptions &
  InternalConfig & { measurements: MeasurementStep[] } & {
    [key: string]: unknown;
  };

/**
 * Partial user-supplied configuration.
 *
 * Pass to the engine constructor to override any property from
 * {@link ConfigOptions}. Omitted properties use their defaults.
 */
type UserConfig = Partial<SpeedTestConfig>;

/** Per-type measurement result bucket stored in Results.raw. */
interface MeasurementResult {
  started: boolean;
  finished: boolean;
  finishedCurrentRound?: boolean;
  error?: unknown;
  results: Record<string, unknown>;
  [key: string]: unknown;
}

/** Payload emitted when the engine advances to a new measurement phase. */
interface PhaseChangePayload {
  /** Index of the current measurement step within the configured measurements array. */
  measurementId: number;
  /** Configuration of the measurement phase that is starting. */
  measurement: MeasurementStep;
}

/**
 * Measurement types whose engines support pause/resume via `pause()` and `play()`.
 * Other types (packetLoss, reachability) run to completion once started.
 */
const pausableTypes: MeasurementType[] = [
  'latency',
  'latencyUnderLoad',
  'download',
  'upload'
];

/** Generate a random numeric string used to correlate log entries for a measurement run. */
// TODO: consider replacing with crypto.randomUUID() for better uniqueness
const genMeasId = (): string => `${Math.round(Math.random() * 1e16)}`;

/**
 * Core speed test engine that orchestrates measurement phases (latency,
 * download, upload, packet loss, reachability) and exposes results via
 * callbacks and the {@link results} property.
 *
 * @example
 * ```ts
 * const engine = new MeasurementEngine({ autoStart: false });
 * engine.onResultsChange = () => console.log(engine.results.getSummary());
 * engine.onFinish = results => console.log('Done!', results.getScores());
 * engine.play();
 * ```
 */
class MeasurementEngine {
  constructor(userConfig: UserConfig = {}) {
    this.#config = Object.assign(
      {},
      defaultConfig,
      userConfig,
      internalConfig
    ) as SpeedTestConfig;
    this.#results = new Results(this.#config);
    this.#config.autoStart && this.play();
  }

  get results(): Results {
    return this.#results;
  }

  /** Not paused and not finished. */
  get isRunning(): boolean {
    return this.#running;
  }

  get isFinished(): boolean {
    return this.#finished;
  }

  onRunningChange: (running: boolean) => void = () => {};

  onResultsChange: (payload: { type: MeasurementType }) => void = () => {};

  onPhaseChange: (payload: PhaseChangePayload) => void = () => {};

  #onFinish: (results: Results) => void = () => {};

  set onFinish(f: (results: Results) => void) {
    this.#onFinish = f;
  }

  #onError: (message: string) => void = () => {};

  set onError(f: (message: string) => void) {
    this.#onError = f;
  }

  // Public methods

  /**
   * Pauses the test. The current measurement phase is suspended (if pausable)
   * and can be resumed with {@link play}. Accumulated runtime is preserved.
   */
  pause(): void {
    const curType = this.#curType();
    curType && pausableTypes.includes(curType) && this.#curEngine?.pause?.();
    this.#setRunning(false);
  }

  /**
   * Starts or resumes the test.
   *
   * On first call, clears the browser's resource timing buffer and begins
   * the measurement sequence. On subsequent calls after {@link pause},
   * resumes the current phase.
   */
  play(): void {
    if (!this.#running) {
      // Clear timings before running the engine
      performance.clearResourceTimings();

      // Default is 250. This can mean the buffer is filled between measurements if many requests are being done
      // in the same page the engine is running.
      performance.setResourceTimingBufferSize(10000);
      this.#setRunning(true);
      this.#next();
    }
  }

  restart(): void {
    this.#clear();
    this.play();
  }

  // Internal state
  readonly #config: SpeedTestConfig;
  readonly #results: Results;

  #measurementId: string = genMeasId();
  #curMsmIdx: number = -1;
  #curEngine: Engine | undefined;
  #optimalDownloadChunkSize: number = DEFAULT_OPTIMAL_DOWNLOAD_SIZE;
  #optimalUploadChunkSize: number = DEFAULT_OPTIMAL_UPLOAD_SIZE;

  /**
   * High-resolution timestamp (from performance.now()) of the test start or
   * last unpause. Used to calculate totalDurationMs in the final results.
   */
  #startTime: number | undefined;

  /**
   * Accumulated time running the test (unpaused), in milliseconds.
   * Used to calculate totalDurationMs in the final results.
   */
  #accumulatedRuntimeMs: number = 0;

  #running: boolean = false;
  #finished: boolean = false;

  // Internal methods
  #setRunning(running: boolean): void {
    if (running !== this.#running) {
      this.#running = running;
      this.onRunningChange(this.#running);
    }

    if (running) {
      this.#startTime = performance.now();
    } else {
      if (typeof this.#startTime !== 'undefined') {
        this.#accumulatedRuntimeMs += performance.now() - this.#startTime;
        this.#startTime = undefined;
      }
    }
  }

  #setFinished(finished: boolean): void {
    if (finished !== this.#finished) {
      this.#finished = finished;
      if (finished) {
        this.#results.raw.totalDurationMs = this.#accumulatedRuntimeMs;
        setTimeout(() => this.#onFinish(this.results));
      }
    }
  }

  #curType(): MeasurementType | null {
    return this.#curMsmIdx < 0 ||
      this.#curMsmIdx >= this.#config.measurements.length
      ? null
      : this.#config.measurements[this.#curMsmIdx].type;
  }

  #curTypeResults(): MeasurementResult | undefined {
    const type = this.#curType();
    if (!type) return undefined;
    return (
      (this.#results.raw as Record<string, MeasurementResult>)[type] ||
      undefined
    );
  }

  #clear(): void {
    this.#destroyCurEngine();

    this.#measurementId = genMeasId();
    this.#curMsmIdx = -1;
    this.#curEngine = undefined;

    this.#setRunning(false);
    this.#setFinished(false);

    this.#results.clear();
    this.#accumulatedRuntimeMs = 0;
  }

  #destroyCurEngine(): void {
    const engine = this.#curEngine;
    if (!engine) return;

    engine.onFinished =
      engine.onConnectionError =
      engine.onMsgReceived =
      engine.onCredentialsFailure =
      engine.onMeasurementResult =
        () => {};

    const curType = this.#curType();
    curType && pausableTypes.includes(curType) && engine.pause?.();
  }

  #next(): void {
    const resumeType = this.#curType();
    const resumeResults = this.#curTypeResults();
    if (
      resumeType &&
      pausableTypes.includes(resumeType) &&
      resumeResults &&
      resumeResults.started &&
      !resumeResults.finished &&
      !resumeResults.finishedCurrentRound &&
      !resumeResults.error
    ) {
      this.#curEngine?.play?.();
      return;
    }

    // advance to next msm
    this.#curMsmIdx++;
    if (this.#curMsmIdx >= this.#config.measurements.length) {
      // done with measurements
      this.#setRunning(false);
      this.#setFinished(true);
      return;
    }

    const { type, ...msmConfig } = this.#config.measurements[
      this.#curMsmIdx
    ] as MeasurementStep;
    const msmResults = this.#curTypeResults() as MeasurementResult;

    this.onPhaseChange({
      measurementId: this.#curMsmIdx,
      measurement: { type, ...msmConfig }
    });

    const { downloadApiUrl, uploadApiUrl, estimatedServerTime } = this.#config;

    let engine: Engine | undefined;
    switch (type) {
      case 'v4Reachability':
      case 'v6Reachability':
        engine = new ReachabilityEngine(`https://${msmConfig.host}`, {
          fetchOptions: {
            method: 'GET',
            mode: 'no-cors'
          }
        }) as Engine;
        engine.onFinished = (result: unknown) => {
          const r = result as Record<string, unknown>;
          msmResults.finished = true;
          msmResults.results = {
            host: msmConfig.host,
            ...r
          };
          this.onResultsChange({ type });
          this.#next();
        };
        break;
      case 'rpki':
        engine = new ReachabilityEngine(
          `https://${this.#config.rpkiInvalidHost}`,
          {
            timeout: 5000
          }
        ) as Engine;
        engine.onFinished = (result: unknown) => {
          const r = result as Record<string, unknown>;
          (r.response
            ? (r.response as Response).json()
            : Promise.resolve()
          ).then((response: Record<string, unknown> | undefined) => {
            msmResults.finished = true;
            msmResults.results = {
              host: this.#config.rpkiInvalidHost,
              filteringInvalids: !r.reachable,
              ...(response
                ? {
                    asn: response.asn,
                    name: response.name
                  }
                : {})
            };
            this.onResultsChange({ type });
            this.#next();
          });
        };
        break;
      case 'nxdomain':
        engine = new ReachabilityEngine(`https://${msmConfig.nxhost}`, {
          fetchOptions: { mode: 'no-cors' }
        }) as Engine;
        engine.onFinished = (result: unknown) => {
          const r = result as Record<string, unknown>;
          msmResults.finished = true;
          msmResults.results = {
            host: msmConfig.nxhost,
            reachable: r.reachable
          };
          this.onResultsChange({ type });
          this.#next();
        };
        break;
      case 'packetLoss':
      case 'packetLossUnderLoad':
        {
          msmResults.finished = false;

          const { numPackets: numMsgs, ...ptCfg } = msmConfig;
          const {
            turnServerUri,
            turnServerCredsApiUrl: turnServerCredsApi,
            turnServerUser,
            turnServerPass,
            includeCredentials
          } = this.#config;
          engine = new PacketLossEngine({
            turnServerUri,
            turnServerCredsApi,
            turnServerCredsApiIncludeCredentials: includeCredentials,
            turnServerUser: turnServerUser ?? undefined,
            turnServerPass: turnServerPass ?? undefined,
            numMsgs,

            // if under load
            downloadChunkSize: msmConfig.loadDown
              ? this.#optimalDownloadChunkSize
              : undefined,
            uploadChunkSize: msmConfig.loadUp
              ? this.#optimalUploadChunkSize
              : undefined,
            downloadApiUrl,
            uploadApiUrl,

            ...ptCfg
          }) as Engine;
        }

        engine!.onMsgReceived = () => {
          msmResults.results = Object.assign(
            {},
            (engine as Engine).results as Record<string, unknown>
          );
          this.onResultsChange({ type });
        };

        engine!.onFinished = () => {
          msmResults.finished = true;
          this.onResultsChange({ type });
          this.#next();
        };

        engine!.onConnectionError = (e: unknown) => {
          msmResults.error = e;
          this.onResultsChange({ type });
          this.#onError(`Connection error while measuring packet loss: ${e}`);
          this.#next();
        };

        engine!.onCredentialsFailure = () => {
          msmResults.error = 'unable to get turn server credentials';
          this.onResultsChange({ type });
          this.#onError(
            'Error while measuring packet loss: unable to get turn server credentials.'
          );
          this.#next();
        };

        break;
      case 'latency':
      case 'latencyUnderLoad':
        msmResults.finished = false;

        engine = new BandwidthEngine(
          [
            {
              dir: 'down',
              bytes: 0,
              count: msmConfig.numPackets!,
              bypassMinDuration: true
            }
          ],
          {
            downloadApiUrl,
            uploadApiUrl,
            estimatedServerTime,
            logApiUrl: this.#config.logMeasurementApiUrl ?? undefined,
            measurementId: this.#measurementId,
            sessionId: this.#config.sessionId,

            // if under load
            downloadChunkSize: msmConfig.loadDown
              ? this.#optimalDownloadChunkSize
              : undefined,
            uploadChunkSize: msmConfig.loadUp
              ? this.#optimalUploadChunkSize
              : undefined
          } as Record<string, unknown>
        ) as Engine;
        (
          engine as Engine & { fetchOptions: Record<string, unknown> }
        ).fetchOptions = {
          credentials: this.#config.includeCredentials ? 'include' : undefined
        };
        (
          engine as Engine & { abortRequestDuration: number }
        ).abortRequestDuration = this.#config.bandwidthAbortRequestDuration;

        engine.onMeasurementResult = engine.onNewMeasurementStarted = (
          _meas: unknown,
          results: unknown
        ) => {
          const res = results as Record<string, Record<number, unknown>>;
          msmResults.results = Object.assign({}, res.down[0]);
          this.onResultsChange({ type });
        };

        engine.onFinished = () => {
          msmResults.finished = true;
          this.onResultsChange({ type });
          this.#running && this.#next();
        };

        engine.onConnectionError = (e: unknown) => {
          msmResults.error = e;
          this.onResultsChange({ type });
          this.#onError(`Connection error while measuring latency: ${e}`);
          this.#next();
        };

        (engine as Engine & { play: () => void }).play!();
        break;
      case 'download':
      case 'upload':
        if (msmResults.finished || msmResults.error) {
          this.#next(); // skip, already concluded this bandwidth measurement type
        } else {
          delete msmResults.finishedCurrentRound;

          const measureParallelLatency = this.#config[
            `measure${type === 'download' ? 'Down' : 'Up'}loadLoadedLatency`
          ] as boolean;

          engine = new BandwidthEngine(
            [
              {
                dir: type === 'download' ? ('down' as const) : ('up' as const),
                ...msmConfig
              }
            ] as never[],
            {
              downloadApiUrl,
              uploadApiUrl,
              estimatedServerTime,
              logApiUrl: this.#config.logMeasurementApiUrl ?? undefined,
              measurementId: this.#measurementId,
              measureParallelLatency,
              parallelLatencyThrottleMs: this.#config.loadedLatencyThrottle,
              sessionId: this.#config.sessionId
            }
          ) as Engine;
          (
            engine as Engine & { fetchOptions: Record<string, unknown> }
          ).fetchOptions = {
            credentials: this.#config.includeCredentials ? 'include' : undefined
          };
          (
            engine as Engine & { finishRequestDuration: number }
          ).finishRequestDuration = this.#config.bandwidthFinishRequestDuration;
          (
            engine as Engine & { abortRequestDuration: number }
          ).abortRequestDuration = this.#config.bandwidthAbortRequestDuration;

          engine.onNewMeasurementStarted = (...args: unknown[]) => {
            const { count, bytes } = args[0] as {
              count: number;
              bytes: number;
            };
            const res = (msmResults.results = Object.assign(
              {},
              msmResults.results
            ));

            !res.hasOwnProperty(bytes) &&
              (res[bytes] = {
                timings: [],
                numMeasurements: 0,
                sideLatency: measureParallelLatency ? [] : undefined
              });

            const bucket = res[bytes] as {
              timings: unknown[];
              numMeasurements: number;
            };
            // check if count hasn't already been added
            if (bucket.numMeasurements - bucket.timings.length !== count) {
              bucket.numMeasurements += count;
              this.onResultsChange({ type });
            }
          };

          engine.onMeasurementResult = (...args: unknown[]) => {
            const { bytes, ...timing } = args[0] as {
              bytes: number;
              [key: string]: unknown;
            };
            // merge in new result
            (msmResults.results[bytes] as { timings: unknown[] }).timings.push(
              timing
            );
            msmResults.results = Object.assign({}, msmResults.results);
            this.onResultsChange({ type });
          };

          engine.onParallelLatencyResult = (res: unknown) => {
            // merge in new latency result
            (
              msmResults.results[msmConfig.bytes!] as {
                sideLatency: unknown[];
              }
            ).sideLatency.push(res);
            msmResults.results = Object.assign({}, msmResults.results);
            this.onResultsChange({ type });
          };

          engine.onFinished = (results: unknown) => {
            const bwResults = results as Record<
              string,
              Record<
                string,
                {
                  timings: { duration: number }[];
                }
              >
            >;
            const isLastMsmOfType = !this.#config.measurements
              .slice(this.#curMsmIdx + 1)
              .map(d => d.type)
              .includes(type);

            const minDuration = Math.min(
              ...Object.values(
                type === 'download' ? bwResults.down : bwResults.up
              )
                .slice(-1)[0]
                .timings.map(d => d.duration)
            );

            const reachedEndOfMsmType =
              isLastMsmOfType ||
              (!msmConfig.bypassMinDuration &&
                minDuration > this.#config.bandwidthFinishRequestDuration);

            if (!reachedEndOfMsmType) {
              msmResults.finishedCurrentRound = true;
            } else {
              msmResults.finished = true;
              this.onResultsChange({ type });

              // record optimal load size
              const largestSize = Object.keys(msmResults.results)
                .map(n => +n)
                .sort((a, b) => b - a)[0];
              const optimalSize = largestSize * OPTIMAL_SIZE_RATIO;

              type === 'download' &&
                (this.#optimalDownloadChunkSize = optimalSize);
              type === 'upload' && (this.#optimalUploadChunkSize = optimalSize);
            }

            this.#running && this.#next();
          };

          engine.onConnectionError = (e: unknown) => {
            msmResults.error = e;
            this.onResultsChange({ type });
            this.#onError(`Connection error while measuring ${type}: ${e}`);
            this.#next();
          };

          (engine as Engine & { play: () => void }).play!();
        }
        break;
      default:
    }

    this.#curEngine = engine;

    msmResults.started = true;
    this.onResultsChange({ type });
  }
}

/**
 * Extended {@link MeasurementEngine} that automatically logs final AIM scores
 * to `aim.cloudflare.com` when the test completes.
 *
 * This is the default export of the library and the recommended entry point
 * for most consumers.
 *
 * @example
 * ```ts
 * import SpeedTest from '@cloudflare/speedtest';
 *
 * const engine = new SpeedTest();
 * engine.onFinish = results => console.log(results.getScores());
 * ```
 */
class SpeedTestEngine extends MeasurementEngine {
  constructor(userConfig: UserConfig = {}) {
    super(userConfig);
    super.onFinish = this.#logFinalResults;

    const config = Object.assign(
      {},
      defaultConfig,
      userConfig,
      internalConfig
    ) as SpeedTestConfig;

    this.#logAimApiUrl = config.logAimApiUrl;
    this.#sessionId = config.sessionId;
  }

  // Public attributes

  /**
   * Called when all measurement phases have completed.
   *
   * The user-supplied callback runs first, then final results are logged
   * to the AIM API automatically.
   */
  set onFinish(onFinish: (results: Results) => void) {
    super.onFinish = (results: Results) => {
      onFinish(results);
      this.#logFinalResults(results);
    };
  }

  // Internal state
  readonly #logAimApiUrl: string | null;
  readonly #sessionId: string | undefined;

  // Internal methods
  #logFinalResults = (results: Results): void => {
    this.#logAimApiUrl &&
      logFinalResults(results, {
        apiUrl: this.#logAimApiUrl,
        sessionId: this.#sessionId
      });
  };
}

export default SpeedTestEngine;

export type { UserConfig };
export { type default as Results } from './Results';
export type {
  BandwidthPoint,
  BandwidthTiming,
  PacketLossResults,
  ReachabilityResults,
  LatencyTiming
} from './types';
export type { ConfigOptions, MeasurementConfig } from './config/defaultConfig';
export type {
  ExperienceScore,
  ClassificationName,
  Scores,
  MeasurementSummary
} from './Results/ScoresCalculations';
