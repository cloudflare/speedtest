/**
 * Whether `apiUrl` resolves to an HTTPS endpoint. Relative URLs inherit the
 * page origin, so they can only be resolved inside a browser; anything we
 * cannot resolve is treated as insecure.
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
 * may mix schemes: the token is never sent over plain HTTP, where an observer
 * could lift it and the server treats it as compromised.
 */
export const withAuthorizationHeader = (
  init: RequestInit,
  token: string | null | undefined,
  apiUrl: string | null | undefined
): RequestInit => {
  if (!token || !apiUrl || !isSecureApiUrl(apiUrl)) return init;

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
};
