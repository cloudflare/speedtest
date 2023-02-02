import { percentile } from '../utils/numbers';

class MeasurementCalculations {
  constructor(config) {
    this.#config = config;
  }

  // Public methods
  getLatencyPoints = latencyResults => latencyResults.timings.map(d => d.ping);

  getLatency = latencyResults =>
    percentile(
      this.getLatencyPoints(latencyResults),
      this.#config.latencyPercentile
    );

  getJitter(latencyResults) {
    // calc jitter as the average latency delta between consecutive samples
    const pings = this.getLatencyPoints(latencyResults);
    return pings.length < 2
      ? null
      : pings.reduce(
          ({ sumDeltas = 0, prevLatency }, latency) => ({
            sumDeltas:
              sumDeltas +
              (prevLatency !== undefined ? Math.abs(prevLatency - latency) : 0),
            prevLatency: latency
          }),
          {}
        ).sumDeltas /
          (pings.length - 1);
  }

  getBandwidthPoints = bandwidthResults =>
    Object.entries(bandwidthResults)
      .map(([bytes, { timings }]) =>
        timings.map(
          ({ bps, duration, ping, measTime, serverTime, transferSize }) => ({
            bytes: +bytes,
            bps,
            duration,
            ping,
            measTime,
            serverTime,
            transferSize
          })
        )
      )
      .flat();

  getBandwidth = bandwidthResults =>
    percentile(
      this.getBandwidthPoints(bandwidthResults)
        .filter(d => d.duration >= this.#config.bandwidthMinRequestDuration)
        .map(d => d.bps)
        .filter(bps => bps),
      this.#config.bandwidthPercentile
    );

  getLoadedLatency = loadedResults =>
    this.getLatency({ timings: this.#extractLoadedLatencies(loadedResults) });

  getLoadedJitter = loadedResults =>
    this.getJitter({ timings: this.#extractLoadedLatencies(loadedResults) });

  getLoadedLatencyPoints = loadedResults =>
    this.getLatencyPoints({
      timings: this.#extractLoadedLatencies(loadedResults)
    });

  getPacketLoss = plResults => plResults.packetLoss;
  getPacketLossDetails = plResults => plResults;

  getReachability = reachabilityResults => !!reachabilityResults.reachable;
  getReachabilityDetails = d => ({ host: d.host, reachable: d.reachable });

  // Internal state
  #config;

  // Internal methods
  #extractLoadedLatencies = loadedResults =>
    Object.values(loadedResults)
      .filter(
        // keep only file sizes that saturated the connection
        d =>
          d.timings.length &&
          Math.min(...d.timings.map(d => d.duration)) >=
            this.#config.loadedRequestMinDuration
      )
      .map(d => d.sideLatency || [])
      .flat()
      .slice(-this.#config.loadedLatencyMaxPoints); // last measurements are most accurate
}

export default MeasurementCalculations;
