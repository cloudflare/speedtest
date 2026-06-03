export const sum = (vals: number[]): number =>
  vals.reduce((agg, val) => agg + val, 0);

export const avg = (vals: number[]): number =>
  vals.length ? sum(vals) / vals.length : 0;

/**
 * Returns the value at the given percentile using linear interpolation.
 *
 * @param vals - Sample values (unsorted is fine — they are sorted internally).
 * @param perc - Percentile as a fraction (0–1). Default: `0.5` (median).
 * @returns The interpolated percentile value, or `0` if the array is empty.
 */
export const percentile = (vals: number[], perc: number = 0.5): number => {
  if (!vals.length) return 0;

  const sortedVals = vals.slice().sort((a, b) => a - b);

  const idx = (vals.length - 1) * perc;
  const rem = idx % 1;

  if (rem === 0) return sortedVals[Math.round(idx)];

  // calculate weighted average
  const edges = [Math.floor, Math.ceil].map(rndFn => sortedVals[rndFn(idx)]);
  return edges[0] + (edges[1] - edges[0]) * rem;
};
