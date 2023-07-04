const REL_API_URL = 'https://speed.cloudflare.com';

export default {
  // Engine
  autoStart: true,

  // APIs
  downloadApiUrl: `${REL_API_URL}/__down`,
  uploadApiUrl: `${REL_API_URL}/__up`,
  logMeasurementApiUrl: null,
  logAimApiUrl: 'https://aim.cloudflare.com/__log',
  turnServerUri: 'turn.speed.cloudflare.com:50000',
  turnServerCredsApiUrl: `${REL_API_URL}/turn-creds`,
  turnServerUser: null,
  turnServerPass: null,
  rpkiInvalidHost: 'invalid.rpki.cloudflare.com',
  cfTraceUrl: `${REL_API_URL}/cdn-cgi/trace`,
  includeCredentials: false,

  // Measurements
  measurements: [
    { type: 'latency', numPackets: 1 }, // initial ttfb estimation
    { type: 'download', bytes: 1e5, count: 1, bypassMinDuration: true }, // initial download estimation
    { type: 'latency', numPackets: 20 },
    { type: 'download', bytes: 1e5, count: 9 },
    { type: 'download', bytes: 1e6, count: 8 },
    { type: 'upload', bytes: 1e5, count: 8 },
    {
      type: 'packetLoss',
      numPackets: 1e3,
      batchSize: 10,
      batchWaitTime: 10, // ms (in between batches)
      responsesWaitTime: 3000 // ms (silent time after last sent msg)
    },
    { type: 'upload', bytes: 1e6, count: 6 },
    { type: 'download', bytes: 1e7, count: 6 },
    { type: 'upload', bytes: 1e7, count: 4 },
    { type: 'download', bytes: 2.5e7, count: 4 },
    { type: 'upload', bytes: 2.5e7, count: 4 },
    { type: 'download', bytes: 1e8, count: 3 },
    { type: 'upload', bytes: 5e7, count: 3 },
    { type: 'download', bytes: 2.5e8, count: 2 }
  ],
  measureDownloadLoadedLatency: true,
  measureUploadLoadedLatency: true,
  loadedLatencyThrottle: 400, // ms in between loaded latency requests
  bandwidthFinishRequestDuration: 1000, // download/upload duration (ms) to reach for stopping further measurements
  estimatedServerTime: 10, // ms to discount from latency calculation (if not present in response headers)

  // Result interpretation
  latencyPercentile: 0.5, // Percentile used to calculate latency from a set of measurements
  bandwidthPercentile: 0.9, // Percentile used to calculate bandwidth from a set of measurements
  bandwidthMinRequestDuration: 10, // minimum duration (ms) to consider a measurement good enough to use in bandwidth calculation
  loadedRequestMinDuration: 250, // minimum duration (ms) of a request to consider it to be loading the connection
  loadedLatencyMaxPoints: 20 // number of data points to keep for loaded latency
};
