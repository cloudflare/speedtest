/**
 * The token and the single policy decision that governs it, passed as one unit
 * so a transport change touches this module instead of every call site.
 */
export interface AuthorizationOptions {
  /** See config `authorizationToken`. */
  token: string | null;
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

/** Latched: a test issues hundreds of requests, and one warning is enough. */
let warnedInsecure = false;

const warnInsecureOnce = (): void => {
  if (warnedInsecure) return;
  warnedInsecure = true;
  console.warn(
    'Sending the authorization token to an endpoint that is not known to be ' +
      'secure, because allowInsecureAuthorizationToken is enabled. Do not ' +
      'enable this outside local development: the server treats a token seen ' +
      'over plaintext as compromised and revokes it.'
  );
};

/**
 * Merges the `Authorization: Bearer <token>` header for `apiUrl` into `init`,
 * preserving any headers the caller already set. Returns `init` untouched when
 * there is no token, or when the token must not be sent to `apiUrl`.
 *
 * A header rather than a query-string param: request URLs are routinely
 * persisted in server-side logs, traces and error reports, so a bearer
 * credential must not travel in one. Applied to the measurement (`__down`,
 * `__up`), TURN credential and logging endpoints — the reachability, RPKI and
 * NXDOMAIN probe hosts are unrelated and never receive it.
 *
 * Resolved per target URL rather than once per engine, because a single config
 * may mix schemes: by default the token is withheld from anything that is not
 * known to be HTTPS, where an observer could lift it and the server treats it
 * as compromised.
 */
export const withAuthorizationHeader = (
  init: RequestInit,
  authorization: AuthorizationOptions | null | undefined,
  apiUrl: string | null | undefined
): RequestInit => {
  if (!authorization?.token || !apiUrl) return init;

  if (!isSecureApiUrl(apiUrl)) {
    if (!authorization.allowInsecure) return init;
    warnInsecureOnce();
  }

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${authorization.token}`);
  return { ...init, headers };
};
