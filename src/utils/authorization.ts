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

/** The config fields {@link applyAuthorizationToken} rewrites. */
interface AuthorizableUrls {
  authorizationToken: string | null;
  downloadApiUrl: string;
  uploadApiUrl: string;
  turnServerCredsApiUrl: string;
  logAimApiUrl: string | null;
  logMeasurementApiUrl: string | null;
}

/**
 * Bakes the token into every billed API URL so the engines inherit it.
 * Excludes the reachability/RPKI/NXDOMAIN probes, which hit unrelated hosts.
 * Mutates `config`, which is always a freshly merged object.
 */
export const applyAuthorizationToken = <T extends AuthorizableUrls>(
  config: T
): T => {
  const token = config.authorizationToken;
  if (!token) return config;

  config.downloadApiUrl = withAuthorizationToken(config.downloadApiUrl, token);
  config.uploadApiUrl = withAuthorizationToken(config.uploadApiUrl, token);
  config.turnServerCredsApiUrl = withAuthorizationToken(
    config.turnServerCredsApiUrl,
    token
  );
  if (config.logAimApiUrl)
    config.logAimApiUrl = withAuthorizationToken(config.logAimApiUrl, token);
  if (config.logMeasurementApiUrl)
    config.logMeasurementApiUrl = withAuthorizationToken(
      config.logMeasurementApiUrl,
      token
    );

  return config;
};
