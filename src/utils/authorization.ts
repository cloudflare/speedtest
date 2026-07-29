/** Query-string parameter carrying the authorization token. */
export const AUTHORIZATION_TOKEN_PARAM = 'token';

/**
 * Returns `apiUrl` with the authorization token appended as a query-string
 * parameter, preserving any params already present.
 *
 * The token is sent in the query string rather than a header to avoid a CORS
 * preflight on the measurement endpoints: an extra round trip there would cost
 * test time and, by reusing the TCP connection, suppress the server-time
 * calibration in `BandwidthEngine` that relies on seeing a fresh handshake.
 *
 * Returns `apiUrl` untouched when there is no token, or when the resolved URL
 * is not HTTPS — a token observed in cleartext must be treated as compromised,
 * so it must never leave the client over plain HTTP.
 */
export const withAuthorizationToken = (
  apiUrl: string,
  token: string | null
): string => {
  if (!token) return apiUrl;

  const urlObj = new URL(apiUrl, window.location.origin);
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
 * Bakes the authorization token into every API URL billed to a customer, so
 * that the engines inherit it through the URLs they already receive.
 *
 * The reachability, RPKI and NXDOMAIN probes are deliberately excluded: they
 * target unrelated hosts rather than the measurement endpoints. Mutates and
 * returns `config`, which is always a freshly merged object.
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
