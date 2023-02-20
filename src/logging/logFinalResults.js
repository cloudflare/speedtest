import 'isomorphic-fetch';

const round = (num, decimals = 0) =>
  !num ? num : Math.round(num * 10 ** decimals) / 10 ** decimals;

const latencyPointsParser = durations => durations.map(d => round(d, 2));
const bpsPointsParser = pnts =>
  pnts.map(d => ({
    bytes: +d.bytes,
    bps: round(d.bps)
  }));

const packetLossParser = d =>
  d.error
    ? undefined
    : {
        numMessages: d.numMessagesSent,
        lossRatio: round(d.packetLoss, 4)
      };

const resultsParsers = {
  latencyMs: ['getUnloadedLatencyPoints', latencyPointsParser],
  download: ['getDownloadBandwidthPoints', bpsPointsParser],
  upload: ['getUploadBandwidthPoints', bpsPointsParser],
  downLoadedLatencyMs: ['getDownLoadedLatencyPoints', latencyPointsParser],
  upLoadedLatencyMs: ['getUpLoadedLatencyPoints', latencyPointsParser],
  packetLoss: ['getPacketLossDetails', packetLossParser]
  // v4Reachability: ['getV4ReachabilityDetails'],
  // v6Reachability: ['getV6ReachabilityDetails']
};

const scoreParser = d => ({
  points: d.points,
  classification: d.classificationName
});

const logAimResults = (results, { apiUrl }) => {
  const logData = {};
  Object.entries(resultsParsers).forEach(([logK, [fn, parser = d => d]]) => {
    const val = results[fn]();
    val && (logData[logK] = parser(val));
  });

  const scores = results.getScores();
  scores &&
    (logData.scores = Object.assign(
      {},
      ...Object.entries(scores).map(([k, score]) => ({
        [k]: scoreParser(score)
      }))
    ));

  fetch(apiUrl, {
    method: 'POST',
    body: JSON.stringify(logData)
  });
};

export default logAimResults;
