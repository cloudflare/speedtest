/** Parses a measurement target, which must be a bare http(s) origin. */
const parseOrigin = (target: string): string => {
  let url: URL | undefined;
  try {
    url = new URL(target);
  } catch {
    // Reported below with the other invalid shapes
  }
  if (
    !url ||
    !/^https?:$/.test(url.protocol) ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new TypeError(
      `Invalid measurementTargets entry "${target}": expected an origin such as https://speed.cloudflare.com`
    );
  }
  return url.origin;
};

/**
 * API URLs at `path`, one per measurement target origin, or the fallback URL
 * when there are no targets. Throws a `TypeError` for a target that isn't an
 * http(s) origin.
 */
export const resolveApiUrls = (
  targets: string[],
  path: '/__down' | '/__up',
  fallbackUrl: string
): string[] =>
  targets.length
    ? targets.map(target => new URL(path, parseOrigin(target)).href)
    : [fallbackUrl];
