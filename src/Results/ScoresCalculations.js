import { scaleThreshold } from 'd3-scale';

import { sum } from '../utils/numbers';

const classificationNames = ['bad', 'poor', 'average', 'good', 'great'];

const customResultTypes = {
  loadedLatencyIncrease: measurements =>
    Math.max(measurements.downLoadedLatency, measurements.upLoadedLatency) -
    measurements.latency
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
          return {
            [type]: val === undefined ? 0 : +fn(val)
          };
        }
      )
    );

    return Object.assign(
      ...Object.entries(this.#config.aimExperiencesDefs).map(
        ([k, { input, pointThresholds }]) => {
          const sumPoints = sum(input.map(k => scores[k]));
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
        }
      )
    );
  }

  // Internal state
  #config;
}

export default ScoresCalculations;
