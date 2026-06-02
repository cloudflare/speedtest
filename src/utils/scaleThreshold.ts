/**
 * Simplified replacement for d3-scale's scaleThreshold.
 * Maps a continuous value to a discrete range based on threshold breakpoints.
 *
 * Unlike d3-scale, this does NOT return `undefined` for NaN/null/undefined
 * inputs — it returns range[0] instead. Callers must guard against
 * non-numeric input if that distinction matters.
 *
 * @param domain - Sorted threshold breakpoints
 * @param range - Output values (must have domain.length + 1 elements)
 * @returns Threshold scale function
 */
const scaleThreshold = (
  domain: number[],
  range: number[]
): ((value: number) => number) => {
  return (value: number): number => {
    let i = 0;
    while (i < domain.length && value >= domain[i]) i++;
    return range[i];
  };
};

export default scaleThreshold;
