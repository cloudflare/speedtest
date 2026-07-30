/**
 * Query-string parameter carrying the authorization token.
 *
 * Named `auth`, not `token`: the measurement log POST body already has a
 * `token` field holding a server-issued per-measurement value, and both are
 * sent to `logMeasurementApiUrl`.
 */
export const AUTHORIZATION_TOKEN_PARAM = 'auth';

/** Placeholder substituted for the token in error messages. */
const REDACTED = 'REDACTED';

/**
 * Appends the authorization token to `apiUrl`, preserving existing params.
 *
 * Query string rather than a header, which would trigger a CORS preflight and
 * suppress BandwidthEngine's server-time calibration. Never over plain HTTP.
 */
export const withAuthorizationToken = (
  apiUrl: string,
  token: string | null
): string => {
  if (!token) return apiUrl;

  // Only relative URLs need the page origin, so absolute ones work without a DOM.
  let urlObj: URL;
  try {
    urlObj = new URL(apiUrl);
  } catch {
    urlObj = new URL(apiUrl, window.location.origin);
  }

  if (urlObj.protocol !== 'https:') return apiUrl;

  urlObj.searchParams.set(AUTHORIZATION_TOKEN_PARAM, token);
  return urlObj.href;
};

/**
 * Masks the authorization token in a URL bound for a log or an error callback.
 *
 * Consumers routinely forward `onError` payloads to third-party log sinks, so
 * the credential must not travel with them. Returns `apiUrl` untouched when
 * there is no token to mask.
 */
export const redactAuthorizationToken = (apiUrl: string): string => {
  let urlObj: URL;
  try {
    urlObj = new URL(apiUrl);
  } catch {
    try {
      urlObj = new URL(apiUrl, window.location.origin);
    } catch {
      return apiUrl;
    }
  }

  if (!urlObj.searchParams.has(AUTHORIZATION_TOKEN_PARAM)) return apiUrl;

  urlObj.searchParams.set(AUTHORIZATION_TOKEN_PARAM, REDACTED);
  return urlObj.href;
};

/**
 * Config URLs that carry the authorization token. Single source of truth: a new
 * measurement endpoint must be added here to be attributed.
 *
 * `turnServerUri` is excluded (not HTTP), as are the reachability, RPKI and
 * NXDOMAIN probe hosts, which are unrelated to the measurement endpoints.
 */
export const AUTHORIZABLE_URLS = [
  'downloadApiUrl',
  'uploadApiUrl',
  'turnServerCredsApiUrl',
  'logAimApiUrl',
  'logMeasurementApiUrl'
] as const;

/** The config fields {@link applyAuthorizationToken} rewrites. */
type AuthorizableUrls = { authorizationToken: string | null } & {
  [K in (typeof AUTHORIZABLE_URLS)[number]]: string | null;
};

/**
 * Attaches the token to every URL in {@link AUTHORIZABLE_URLS}, so the engines
 * inherit it through the URLs they already receive. Mutates `config`, which is
 * always a freshly merged object.
 */
export const applyAuthorizationToken = <T extends AuthorizableUrls>(
  config: T
): T => {
  const token = config.authorizationToken;
  if (!token) return config;

  // Widened to write through the union of keys; T only narrows the field types.
  const urls = config as AuthorizableUrls;
  for (const key of AUTHORIZABLE_URLS) {
    const url = urls[key];
    if (url) urls[key] = withAuthorizationToken(url, token);
  }

  return config;
};
