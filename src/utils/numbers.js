export const sum = vals => vals.reduce((agg, val) => agg + val, 0);
export const avg = vals => sum(vals) / vals.length;

export const percentile = (vals, perc = 0.5) => {
  if (!vals.length) return 0;

  const sortedVals = vals.slice().sort((a, b) => a - b);

  const idx = (vals.length - 1) * perc;
  const rem = idx % 1;

  if (rem === 0) return sortedVals[Math.round(idx)];

  // calculate weighted average
  const edges = [Math.floor, Math.ceil].map(rndFn => sortedVals[rndFn(idx)]);
  return edges[0] + (edges[1] - edges[0]) * rem;
};
