import 'isomorphic-fetch';

import { defaultConfig, internalConfig } from './config';
import BandwidthEngine from './engines/LoggingBandwidthEngine';
import PacketLossEngine from './engines/PacketLossEngine';
import ReachabilityEngine from './engines/ReachabilityEngine';

import Results from './Results';
import logFinalResults from './logging/logFinalResults';

const DEFAULT_OPTIMAL_DOWNLOAD_SIZE = 1e6;
const DEFAULT_OPTIMAL_UPLOAD_SIZE = 1e6;
const OPTIMAL_SIZE_RATIO = 0.5; // of largest size reached in measurement

const pausableTypes = ['latency', 'latencyUnderLoad', 'download', 'upload'];

const genMeasId = () => `${Math.round(Math.random() * 1e16)}`;

class MeasurementEngine {
  constructor(userConfig = {}) {
    this.#config = Object.assign({}, defaultConfig, userConfig, internalConfig);
    this.#results = new Results(this.#config);
    this.#config.autoStart && this.play();
  }

  // Public attributes
  get results() {
    // read access to results
    return this.#results;
  }

  get isRunning() {
    return this.#running;
  }

  get isFinished() {
    return this.#finished;
  }

  onRunningChange = () => {};
  onResultsChange = () => {};

  #onFinish = () => {}; // callback invoked when all the measurements are finished
  set onFinish(f) {
    this.#onFinish = f;
  }

  #onError = () => {}; // callback invoked if an error occurs during measurement
  set onError(f) {
    this.#onError = f;
  }

  // Public methods
  pause() {
    pausableTypes.includes(this.#curType()) && this.#curEngine.pause();
    this.#setRunning(false);
  }

  play() {
    if (!this.#running) {
      this.#setRunning(true);
      this.#next();
    }
  }
  restart() {
    this.#clear();
    this.play();
  }

  // Internal state
  #config;
  #results;

  #measurementId = genMeasId();
  #curMsmIdx = -1;
  #curEngine;
  #optimalDownloadChunkSize = DEFAULT_OPTIMAL_DOWNLOAD_SIZE;
  #optimalUploadChunkSize = DEFAULT_OPTIMAL_UPLOAD_SIZE;

  #running = false;
  #finished = false;

  // Internal methods
  #setRunning(running) {
    if (running !== this.#running) {
      this.#running = running;
      this.onRunningChange(this.#running);
    }
  }

  #setFinished(finished) {
    if (finished !== this.#finished) {
      this.#finished = finished;
      finished && setTimeout(() => this.#onFinish(this.results));
    }
  }

  #curType() {
    return this.#curMsmIdx < 0 ||
      this.#curMsmIdx >= this.#config.measurements.length
      ? null
      : this.#config.measurements[this.#curMsmIdx].type;
  }

  #curTypeResults() {
    return this.#results.raw[this.#curType()] || undefined;
  }

  #clear() {
    this.#destroyCurEngine();

    this.#measurementId = genMeasId();
    this.#curMsmIdx = -1;
    this.#curEngine = undefined;

    this.#setRunning(false);
    this.#setFinished(false);

    this.#results.clear();
  }

  #destroyCurEngine() {
    const engine = this.#curEngine;
    if (!engine) return;

    engine.onFinished =
      engine.onConnectionError =
      engine.onFail =
      engine.onMsgReceived =
      engine.onCredentialsFailure =
      engine.onMeasurementResult =
        () => {};

    pausableTypes.includes(this.#curType()) && engine.pause();
  }

  #next() {
    if (
      pausableTypes.includes(this.#curType()) &&
      this.#curTypeResults() &&
      this.#curTypeResults().started &&
      !this.#curTypeResults().finished &&
      !this.#curTypeResults().finishedCurrentRound &&
      !this.#curTypeResults().error
    ) {
      this.#curEngine.play();
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

    const { type, ...msmConfig } = this.#config.measurements[this.#curMsmIdx];
    const msmResults = this.#curTypeResults();

    const { downloadApiUrl, uploadApiUrl, estimatedServerTime } = this.#config;

    let engine;
    switch (type) {
      case 'v4Reachability':
      case 'v6Reachability':
        engine = new ReachabilityEngine(`https://${msmConfig.host}`, {
          fetchOptions: {
            method: 'GET',
            mode: 'no-cors'
          }
        });
        engine.onFinished = result => {
          msmResults.finished = true;
          msmResults.results = {
            host: msmConfig.host,
            ...result
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
        );
        engine.onFinished = result => {
          (result.response ? result.response.json() : Promise.resolve()).then(
            response => {
              msmResults.finished = true;
              msmResults.results = {
                host: this.#config.rpkiInvalidHost,
                filteringInvalids: !result.reachable,
                ...(response
                  ? {
                      asn: response.asn,
                      name: response.name
                    }
                  : {})
              };
              this.onResultsChange({ type });
              this.#next();
            }
          );
        };
        break;
      case 'nxdomain':
        engine = new ReachabilityEngine(`https://${msmConfig.nxhost}`, {
          fetchOptions: { mode: 'no-cors' }
        });
        engine.onFinished = result => {
          msmResults.finished = true;
          msmResults.results = {
            host: msmConfig.nxhost,
            reachable: result.reachable
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
            turnServerUser,
            turnServerPass,
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
          });
        }

        engine.onMsgReceived = () => {
          msmResults.results = Object.assign({}, engine.results);
          this.onResultsChange({ type });
        };

        engine.onFinished = () => {
          msmResults.finished = true;
          this.onResultsChange({ type });
          this.#next();
        };

        engine.onConnectionError = e => {
          msmResults.error = e;
          this.onResultsChange({ type });
          this.#onError(`Connection error while measuring packet loss: ${e}`);
          this.#next();
        };

        engine.onCredentialsFailure = () => {
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
              count: msmConfig.numPackets,
              bypassMinDuration: true
            }
          ],
          {
            downloadApiUrl,
            uploadApiUrl,
            estimatedServerTime,
            logApiUrl: this.#config.logMeasurementApiUrl,
            measurementId: this.#measurementId,

            // if under load
            downloadChunkSize: msmConfig.loadDown
              ? this.#optimalDownloadChunkSize
              : undefined,
            uploadChunkSize: msmConfig.loadUp
              ? this.#optimalUploadChunkSize
              : undefined
          }
        );
        engine.fetchOptions = {
          credentials: this.#config.includeCredentials ? 'include' : undefined
        };

        engine.onMeasurementResult = engine.onNewMeasurementStarted = (
          meas,
          results
        ) => {
          msmResults.results = Object.assign({}, results.down[0]);
          this.onResultsChange({ type });
        };

        engine.onFinished = () => {
          msmResults.finished = true;
          this.onResultsChange({ type });
          this.#running && this.#next();
        };

        engine.onConnectionError = e => {
          msmResults.error = e;
          this.onResultsChange({ type });
          this.#onError(`Connection error while measuring latency: ${e}`);
          this.#next();
        };

        engine.play();
        break;
      case 'download':
      case 'upload':
        if (msmResults.finished || msmResults.error) {
          this.#next(); // skip, already concluded this bandwidth measurement type
        } else {
          delete msmResults.finishedCurrentRound;

          const measureParallelLatency =
            this.#config[
              `measure${type === 'download' ? 'Down' : 'Up'}loadLoadedLatency`
            ];

          engine = new BandwidthEngine(
            [{ dir: type === 'download' ? 'down' : 'up', ...msmConfig }],
            {
              downloadApiUrl,
              uploadApiUrl,
              estimatedServerTime,
              logApiUrl: this.#config.logMeasurementApiUrl,
              measurementId: this.#measurementId,
              measureParallelLatency,
              parallelLatencyThrottleMs: this.#config.loadedLatencyThrottle
            }
          );
          engine.fetchOptions = {
            credentials: this.#config.includeCredentials ? 'include' : undefined
          };
          engine.finishRequestDuration =
            this.#config.bandwidthFinishRequestDuration;

          engine.onNewMeasurementStarted = ({ count, bytes }) => {
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

            // check if count hasn't already been added
            if (
              res[bytes].numMeasurements - res[bytes].timings.length !==
              count
            ) {
              res[bytes].numMeasurements += count;
              this.onResultsChange({ type });
            }
          };

          engine.onMeasurementResult = ({ bytes, ...timing }) => {
            // merge in new result
            msmResults.results[bytes].timings.push(timing);
            msmResults.results = Object.assign({}, msmResults.results);
            this.onResultsChange({ type });
          };

          engine.onParallelLatencyResult = res => {
            // merge in new latency result
            msmResults.results[msmConfig.bytes].sideLatency.push(res);
            msmResults.results = Object.assign({}, msmResults.results);
            this.onResultsChange({ type });
          };

          engine.onFinished = results => {
            const isLastMsmOfType = !this.#config.measurements
              .slice(this.#curMsmIdx + 1)
              .map(d => d.type)
              .includes(type);

            const minDuration = Math.min(
              ...Object.values(type === 'download' ? results.down : results.up)
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

          engine.onConnectionError = e => {
            msmResults.error = e;
            this.onResultsChange({ type });
            this.#onError(`Connection error while measuring ${type}: ${e}`);
            this.#next();
          };

          engine.play();
        }
        break;
      default:
    }

    this.#curEngine = engine;

    msmResults.started = true;
    this.onResultsChange({ type });
  }
}

class LoggingMeasurementEngine extends MeasurementEngine {
  constructor(userConfig, ...pt) {
    super(userConfig, ...pt);
    super.onFinish = this.#logFinalResults;

    this.#logAimApiUrl = Object.assign(
      {},
      defaultConfig,
      userConfig,
      internalConfig
    ).logAimApiUrl;
  }

  // Public attributes
  set onFinish(onFinish) {
    super.onFinish = results => {
      onFinish(results);
      this.#logFinalResults(results);
    };
  }

  // Internal state
  #logAimApiUrl;

  // Internal methods
  #logFinalResults = results => {
    this.#logAimApiUrl &&
      logFinalResults(results, { apiUrl: this.#logAimApiUrl });
  };
}

export default LoggingMeasurementEngine;
