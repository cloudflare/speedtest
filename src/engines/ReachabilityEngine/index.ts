import type { Engine } from '../Engine';

/** Result from a reachability probe. */
export interface ReachabilityResult {
  /** The URL that was probed. */
  targetUrl: string;
  /** Whether the fetch completed without error. */
  reachable: boolean;
  /** The raw Response object (available when reachable). */
  response?: Response;
  /** Error details if the fetch failed. */
  error?: unknown;
}

/** Options for the ReachabilityEngine constructor. */
export interface ReachabilityEngineOptions {
  /** Maximum time to wait for a response (ms). 0 means no timeout. */
  timeout?: number;
  /** Additional options passed to the fetch() call. */
  fetchOptions?: RequestInit;
}

/**
 * Simple reachability probe. Fires a single fetch to a target URL and reports
 * whether it succeeded. Supports an optional timeout that aborts the request
 * if no response arrives within the specified duration.
 */
export default class ReachabilityEngine implements Engine {
  constructor(
    targetUrl: string,
    { timeout = -1, fetchOptions = {} }: ReachabilityEngineOptions = {}
  ) {
    let finished = false;
    const finish = ({
      reachable,
      ...rest
    }: {
      reachable: boolean;
      response?: Response;
      error?: unknown;
    }): void => {
      if (finished) return;
      finished = true;
      this.onFinished({
        targetUrl,
        reachable,
        ...rest
      });
    };

    fetch(targetUrl, fetchOptions)
      .then(response => {
        finish({
          reachable: true,
          response
        });
      })
      .catch(error => {
        finish({
          reachable: false,
          error
        });
      });

    timeout > 0 &&
      setTimeout(
        () => finish({ reachable: false, error: 'Request timeout' }),
        timeout
      );
  }

  // Public attributes
  onFinished: (result: ReachabilityResult) => void = () => {};
}
