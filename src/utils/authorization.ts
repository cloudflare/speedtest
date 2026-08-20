/**
 * The token and the policy decisions that govern it, passed as one unit so a
 * transport change touches this module instead of every call site.
 */
export interface AuthorizationOptions {
  /** See config `authorizationToken`. */
  token: string | null;
  /** See config `authorizationEnabled`. */
  enabled: 'header' | boolean | undefined;
  /** See config `allowInsecureAuthorizationToken`. */
  allowInsecure: boolean;
}

/**
 * Whether `apiUrl` resolves to an HTTPS endpoint. Relative URLs inherit the
 * page origin, so they can only be resolved inside a browser; anything we
 * cannot resolve is not known to be secure.
 */
const isSecureApiUrl = (apiUrl: string): boolean => {
  try {
    return new URL(apiUrl).protocol === 'https:';
  } catch {
    try {
      return new URL(apiUrl, window.location.origin).protocol === 'https:';
    } catch {
      return false;
    }
  }
};

/**
 * Latched per options object — which is one per engine — so a run warns once
 * rather than once per request, and a second run warns again.
 */
const warnedInsecure = new WeakSet<AuthorizationOptions>();

const warnInsecureOnce = (authorization: AuthorizationOptions): void => {
  if (warnedInsecure.has(authorization)) return;
  warnedInsecure.add(authorization);
  console.warn(
    'Sending the authorization token to an endpoint that is not known to be ' +
      'secure, because allowInsecureAuthorizationToken is enabled. Do not ' +
      'enable this outside local development: the server treats a token seen ' +
      'over plaintext as compromised and revokes it.'
  );
};

/**
 * Merges the `Authorization: Bearer <token>` header for `apiUrl` into `init`,
 * preserving any headers the caller already set. Returns `init` untouched
 * unless a token exists, `enabled` opts in, and the token may be sent to
 * `apiUrl`.
 *
 * A header, not a query param: request URLs get persisted in logs and traces.
 * Evaluated per target URL, since one config may mix schemes.
 */
export const withAuthorizationHeader = (
  init: RequestInit,
  authorization: AuthorizationOptions | null | undefined,
  apiUrl: string | null | undefined
): RequestInit => {
  if (!authorization?.enabled || !apiUrl) return init;

  // Whitespace-only is as good as absent, and no valid token carries padding.
  const token = authorization.token?.trim();
  if (!token) return init;

  if (!isSecureApiUrl(apiUrl)) {
    if (!authorization.allowInsecure) return init;
    warnInsecureOnce(authorization);
  }

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers: Object.fromEntries(headers) };
};
