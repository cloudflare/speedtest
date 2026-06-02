/* eslint-disable @typescript-eslint/no-explicit-any -- Callbacks use any[]
   because each engine has different callback signatures (e.g., onFinished
   receives BandwidthEngineResults, PacketLossResults, or ReachabilityResult
   depending on the engine). The Engine interface is only used for storage
   and cleanup in MeasurementEngine.#curEngine, not for type-safe callback
   invocation — callbacks are set up with specific engine types. */

/**
 * Structural interface that every measurement engine satisfies.
 *
 * `MeasurementEngine` stores the current engine as `#curEngine: Engine` and
 * calls the optional lifecycle methods (`pause`, `play`) and callback setters
 * listed here. Concrete engines do **not** need to declare every member —
 * only the ones they actually expose.
 */
export interface Engine {
  /**
   * Callback invoked when the engine finishes its measurement.
   * Every engine must expose this setter.
   */
  onFinished: (...args: any[]) => void;

  /** Invoked when a connection-level error prevents measurement. */
  onConnectionError?: (...args: any[]) => void;

  /** Invoked when a message is received (packet-loss engines). */
  onMsgReceived?: (...args: any[]) => void;

  /** Invoked when TURN credentials cannot be fetched. */
  onCredentialsFailure?: (...args: any[]) => void;

  /** Invoked for each individual timing result (bandwidth engines). */
  onMeasurementResult?: (...args: any[]) => void;

  /** Invoked when a new measurement round starts for a given byte size. */
  onNewMeasurementStarted?: (...args: any[]) => void;

  /** Invoked for each parallel-latency sample collected alongside a bandwidth measurement. */
  onParallelLatencyResult?: (...args: any[]) => void;

  pause?: () => void;

  play?: () => void;

  /** Shape depends on the concrete engine. */
  results?: unknown;

  /** Additional options forwarded to every `fetch()` call the engine makes. */
  fetchOptions?: RequestInit;

  /**
   * Request duration threshold (ms) at which the engine considers a
   * measurement complete and stops issuing further requests.
   */
  finishRequestDuration?: number;

  /**
   * Maximum allowed request duration (ms). If a single request exceeds this
   * value the engine aborts the measurement.
   */
  abortRequestDuration?: number;
}
