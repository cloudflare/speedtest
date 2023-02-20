import MeasurementCalculations from './MeasurementCalculations';
import ScoresCalculations from './ScoresCalculations';

class Results {
  constructor(config) {
    this.#config = config;
    this.clear();
    this.#measCalc = new MeasurementCalculations(this.#config);
    this.#scoresCalc = new ScoresCalculations(this.#config);
  }

  // Public attributes
  raw;

  get isFinished() {
    return Object.values(this.raw).every(d => d.finished);
  }

  // Public methods
  clear() {
    this.raw = Object.assign(
      {},
      ...[...new Set(this.#config.measurements.map(m => m.type))].map(m => ({
        [m]: { started: false, finished: false, results: {} }
      }))
    );
  }

  getUnloadedLatency = () => this.#calcGetter('getLatency', 'latency');
  getUnloadedJitter = () => this.#calcGetter('getJitter', 'latency');
  getUnloadedLatencyPoints = () =>
    this.#calcGetter('getLatencyPoints', 'latency', []);
  getDownLoadedLatency = () => this.#calcGetter('getLoadedLatency', 'download');
  getDownLoadedJitter = () => this.#calcGetter('getLoadedJitter', 'download');
  getDownLoadedLatencyPoints = () =>
    this.#calcGetter('getLoadedLatencyPoints', 'download', []);
  getUpLoadedLatency = () => this.#calcGetter('getLoadedLatency', 'upload');
  getUpLoadedJitter = () => this.#calcGetter('getLoadedJitter', 'upload');
  getUpLoadedLatencyPoints = () =>
    this.#calcGetter('getLoadedLatencyPoints', 'upload', []);
  getDownloadBandwidth = () => this.#calcGetter('getBandwidth', 'download');
  getDownloadBandwidthPoints = () =>
    this.#calcGetter('getBandwidthPoints', 'download', []);
  getUploadBandwidth = () => this.#calcGetter('getBandwidth', 'upload');
  getUploadBandwidthPoints = () =>
    this.#calcGetter('getBandwidthPoints', 'upload', []);
  getPacketLoss = () => this.#calcGetter('getPacketLoss', 'packetLoss');
  getPacketLossDetails = () =>
    this.#calcGetter('getPacketLossDetails', 'packetLoss', undefined, true);

  getSummary() {
    const items = {
      download: this.getDownloadBandwidth,
      upload: this.getUploadBandwidth,
      latency: this.getUnloadedLatency,
      jitter: this.getUnloadedJitter,
      downLoadedLatency: this.getDownLoadedLatency,
      downLoadedJitter: this.getDownLoadedJitter,
      upLoadedLatency: this.getUpLoadedLatency,
      upLoadedJitter: this.getUpLoadedJitter,
      packetLoss: this.getPacketLoss,
      v4Reachability: this.#getV4Reachability,
      v6Reachability: this.#getV6Reachability
    };

    return Object.assign(
      ...Object.entries(items).map(([key, fn]) => {
        const val = fn();
        return val === undefined
          ? {}
          : {
              [key]: val
            };
      })
    );
  }

  getScores = () => this.#scoresCalc.getScores(this.getSummary());

  // Internal state
  #config;
  #measCalc;
  #scoresCalc;

  // Internal methods
  #calcGetter = (
    calcFn,
    resKey,
    defaultVal = undefined,
    surfaceError = false
  ) =>
    !this.raw.hasOwnProperty(resKey) || !this.raw[resKey].started
      ? defaultVal
      : surfaceError && this.raw[resKey].error
      ? { error: this.raw[resKey].error }
      : this.#measCalc[calcFn](this.raw[resKey].results);

  #getV4Reachability = () =>
    this.#calcGetter('getReachability', 'v4Reachability');
  #getV4ReachabilityDetails = () =>
    this.#calcGetter('getReachabilityDetails', 'v4Reachability');
  #getV6Reachability = () =>
    this.#calcGetter('getReachability', 'v6Reachability');
  #getV6ReachabilityDetails = () =>
    this.#calcGetter('getReachabilityDetails', 'v6Reachability');
}

export default Results;
