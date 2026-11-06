/** Parses a measurement target, which must be a bare http(s) origin. */
const parseOrigin = (target: string): string => {
  let url: URL | undefined;
  try {
    url = typeof target === 'string' ? new URL(target) : undefined;
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
 * http(s) origin, or a path that doesn't start with `/`.
 */
export const resolveApiUrls = (
  targets: string[],
  { path, option }: { path: string; option: string },
  fallbackUrl: string
): string[] => {
  if (!Array.isArray(targets)) {
    throw new TypeError(
      `Invalid measurementTargets: expected an array of origins, got ${typeof targets}`
    );
  }
  if (typeof path !== 'string') {
    throw new TypeError(
      `Invalid ${option}: expected a path starting with /, got ${typeof path}`
    );
  }
  const resolve = (origin: string): string => {
    let url: URL | undefined;
    try {
      url = path.startsWith('/') ? new URL(path, origin) : undefined;
    } catch {
      // Reported below with the other invalid shapes
    }
    // Rejects paths such as `//host` or `/\host`, which switch hosts
    if (!url || url.origin !== origin) {
      throw new TypeError(
        `Invalid ${option} "${path}": expected a path starting with /`
      );
    }
    return url.href;
  };
  // Checked even when unused, so a bad path fails on construction regardless
  resolve('https://placeholder.invalid');
  return targets.length
    ? targets.map(target => resolve(parseOrigin(target)))
    : [fallbackUrl];
};
