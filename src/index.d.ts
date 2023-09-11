export type MeasurementConfig = {
  type: 'latency',
  numPackets: number
} | {
  type: 'download' | 'upload',
  bytes: number,
  count: number,
  bypassMinDuration?: boolean
} | {
  type: 'packetLoss',
  numPackets?: number,
  batchSize?: number,
  batchWaitTime?: number,
  responsesWaitTime?: number,
  connectionTimeout?: number,
};

export interface ConfigOptions {
  autoStart?: boolean;

  // APIs
  downloadApiUrl?: string,
  uploadApiUrl?: string,
  turnServerUri?: string,
  turnServerUser?: string,
  turnServerPass?: string,
  includeCredentials?: boolean,

  // Measurements
  measurements?: MeasurementConfig[],
  measureDownloadLoadedLatency?: boolean,
  measureUploadLoadedLatency?: boolean,
  loadedLatencyThrottle?: number,
  bandwidthFinishRequestDuration?: number,
  estimatedServerTime?: number;

  // Result interpretation
  latencyPercentile?: number,
  bandwidthPercentile?: number,
  bandwidthMinRequestDuration?: number,
  loadedRequestMinDuration?: number,
  loadedLatencyMaxPoints?: number
}

interface BandwidthPoint {
  bytes: number,
  bps: number,
  duration: number,
  ping: number,
  measTime: number,
  serverTime: number,
  transferSize: number
}

export declare class Results {
  constructor();

  readonly isFinished: boolean;

  getSummary: () => {
    download?: number,
    upload?: number,
    latency?: number,
    jitter?: number,
    downLoadedLatency?: number,
    downLoadedJitter?: number,
    upLoadedLatency?: number,
    upLoadedJitter?: number,
    packetLoss?: number,
  }

  getUnloadedLatency: () => number | undefined;
  getUnloadedJitter: () => number | undefined;
  getUnloadedLatencyPoints: () => number[];
  getDownLoadedLatency: () => number | undefined;
  getDownLoadedJitter: () => number | undefined;
  getDownLoadedLatencyPoints: () => number[];
  getUpLoadedLatency: () => number | undefined;
  getUpLoadedJitter: () => number | undefined;
  getUpLoadedLatencyPoints: () => number[];
  getDownloadBandwidth: () => number | undefined;
  getDownloadBandwidthPoints: () => BandwidthPoint[];
  getUploadBandwidth: () => number | undefined;
  getUploadBandwidthPoints: () => BandwidthPoint[];
  getPacketLoss: () => number | undefined;
  getPacketLossDetails: () => {
    packetLoss: number,
    totalMessages: number,
    numMessagesSent: number,
    lostMessages: number[]
  } | { error: string } | undefined;

  getScores: () => {
    [key: string]: {
      points: number;
      classificationIdx: 0 | 1 | 2 | 3 | 4;
      classificationName: 'bad' | 'poor' | 'average' | 'good' | 'great';
    }
  }
}

declare class SpeedTestEngine {
  constructor(config?: ConfigOptions);

  play: () => void;
  pause: () => void;
  restart: () => void;

  readonly results: Results;
  readonly isRunning: boolean;
  readonly isFinished: boolean;

  onRunningChange: (running: boolean) => void;
  onResultsChange: ({ type: string }) => void;
  onFinish: (results: Results) => void;
  onError: (error: string) => void;
}

export default SpeedTestEngine;