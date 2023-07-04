import { scaleThreshold } from 'd3-scale';

import { sum } from '../utils/numbers';

const classificationNames = ['bad', 'poor', 'average', 'good', 'great'];

const customResultTypes = {
  loadedLatencyIncrease: measurements =>
    measurements.latency &&
    (measurements.downLoadedLatency || measurements.upLoadedLatency)
      ? Math.max(measurements.downLoadedLatency, measurements.upLoadedLatency) -
        measurements.latency
      : undefined
};

const defaultPoints = {
  packetLoss: 0
};

class ScoresCalculations {
  constructor(config) {
    this.#config = config;
  }

  getScores(measurements) {
    const scores = Object.assign(
      ...Object.entries(this.#config.aimMeasurementScoring).map(
        ([type, fn]) => {
          const val = customResultTypes.hasOwnProperty(type)
            ? customResultTypes[type](measurements)
            : measurements[type];
          return val === undefined
            ? defaultPoints.hasOwnProperty(type)
              ? { [type]: defaultPoints[type] }
              : {}
            : {
                [type]: val === undefined ? 0 : +fn(val)
              };
        }
      )
    );

    return Object.assign(
      {},
      ...Object.entries(this.#config.aimExperiencesDefs)
        .filter(([, { input }]) => input.every(k => scores.hasOwnProperty(k)))
        .map(([k, { input, pointThresholds }]) => {
          const sumPoints = Math.max(0, sum(input.map(k => scores[k])));
          const classificationIdx = scaleThreshold(
            pointThresholds,
            [0, 1, 2, 3, 4]
          )(sumPoints);
          const classificationName = classificationNames[classificationIdx];
          return {
            [k]: {
              points: sumPoints,
              classificationIdx,
              classificationName
            }
          };
        })
    );
  }

  // Internal state
  #config;
}

export default ScoresCalculations;
