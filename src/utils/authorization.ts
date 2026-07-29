/** Query-string parameter carrying the authorization token. */
export const AUTHORIZATION_TOKEN_PARAM = 'token';

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
 * Config URLs that carry the authorization token. Single source of truth: a new
 * measurement endpoint must be added here to be attributed.
 *
 * `turnServerUri` is excluded (not HTTP), as are the reachability, RPKI and
 * NXDOMAIN probe hosts, which are unrelated to the measurement endpoints.
 */
export const TOKEN_URL_KEYS = [
  'downloadApiUrl',
  'uploadApiUrl',
  'turnServerCredsApiUrl',
  'logAimApiUrl',
  'logMeasurementApiUrl'
] as const;

/** The config fields {@link applyAuthorizationToken} rewrites. */
type TokenizableUrls = { authorizationToken: string | null } & {
  [K in (typeof TOKEN_URL_KEYS)[number]]: string | null;
};

/**
 * Attaches the token to every URL in {@link TOKEN_URL_KEYS}, so the engines
 * inherit it through the URLs they already receive. Mutates `config`, which is
 * always a freshly merged object.
 */
export const applyAuthorizationToken = <T extends TokenizableUrls>(
  config: T
): T => {
  const token = config.authorizationToken;
  if (!token) return config;

  // Widened to write through the union of keys; T only narrows the field types.
  const urls = config as TokenizableUrls;
  for (const key of TOKEN_URL_KEYS) {
    const url = urls[key];
    if (url) urls[key] = withAuthorizationToken(url, token);
  }

  return config;
};
