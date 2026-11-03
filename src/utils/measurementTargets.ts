/**
 * API URLs at `path`, one per measurement target origin, or the fallback URL
 * when there are no targets.
 */
export const resolveApiUrls = (
  targets: string[],
  path: '/__down' | '/__up',
  fallbackUrl: string
): string[] =>
  targets.length
    ? targets.map(origin => new URL(path, origin).href)
    : [fallbackUrl];
