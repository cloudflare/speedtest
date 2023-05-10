import { scaleThreshold } from 'd3-scale';

export default {
  // AIM
  aimMeasurementScoring: {
    packetLoss: scaleThreshold([0.01, 0.05, 0.25, 0.5], [10, 5, 0, -10, -20]),
    latency: scaleThreshold([10, 20, 50, 100, 500], [20, 10, 5, 0, -10, -20]),
    loadedLatencyIncrease: scaleThreshold(
      [10, 20, 50, 100, 500],
      [20, 10, 5, 0, -10, -20]
    ),
    jitter: scaleThreshold([10, 20, 100, 500], [10, 5, 0, -10, -20]),
    download: scaleThreshold([1e6, 10e6, 50e6, 100e6], [0, 5, 10, 20, 30]),
    upload: scaleThreshold([1e6, 10e6, 50e6, 100e6], [0, 5, 10, 20, 30])
  },
  aimExperiencesDefs: {
    streaming: {
      input: ['latency', 'packetLoss', 'download', 'loadedLatencyIncrease'],
      pointThresholds: [15, 20, 40, 60]
    },
    gaming: {
      input: ['latency', 'packetLoss', 'loadedLatencyIncrease'],
      pointThresholds: [5, 15, 25, 30]
    },
    rtc: {
      input: ['latency', 'jitter', 'packetLoss', 'loadedLatencyIncrease'],
      pointThresholds: [5, 15, 25, 40]
    }
  }
};
