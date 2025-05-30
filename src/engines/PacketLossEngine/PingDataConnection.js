/* global process */
import { spawn } from 'child_process';

export default class PingDataConnection {
  constructor({
    host = 'speed.cloudflare.com',
    timeout = 5000, // 5 seconds timeout for ping command
    maxConcurrent = 10,
    batchDelay = 10, // ms between batches to avoid overwhelming
    ...options
  } = {}) {
    this.#host = host;
    this.#timeout = timeout;
    this.#maxConcurrent = maxConcurrent;
    this.#batchDelay = batchDelay;
    this.#options = options;
    this.#established = false;
    this.#pendingRequests = [];
    this.#activeRequests = 0;
    this.#closed = false;

    // Simulate connection establishment delay like WebRTC
    setTimeout(() => {
      if (!this.#closed) {
        this.#established = true;
        this.onOpen();
      }
    }, 10);
  }

  // Public attributes - same interface as SelfWebRtcDataConnection
  onOpen = () => {}; // callback invoked when connection is established
  onClose = () => {}; // callback invoked when connection is closed
  onMessageReceived = () => {}; // callback invoked when a message is received

  // Public methods - same interface as SelfWebRtcDataConnection
  send(msg) {
    if (!this.#established || this.#closed) {
      return;
    }

    // Queue request if we're at max concurrent limit
    if (this.#activeRequests >= this.#maxConcurrent) {
      this.#pendingRequests.push({ msg, timestamp: Date.now() });
      return;
    }

    this.#sendPing(msg);
  }

  close() {
    this.#closed = true;
    this.#established = false;

    // Clear pending requests
    this.#pendingRequests = [];

    this.onClose();
    return this;
  }

  // Internal methods
  #sendPing(msg) {
    if (this.#closed) return;

    this.#activeRequests++;

    const jitter = Math.random() * this.#batchDelay;

    setTimeout(() => {
      if (this.#closed) {
        this.#activeRequests--;
        return;
      }

      // Use 'ping' command with arguments as an array for security
      // -c 1: send 1 packet
      // -W <timeout>: wait <timeout> seconds for response (macOS/Linux)
      // -w <timeout>: wait <timeout> milliseconds for response (Windows)
      const isWindows = process.platform === 'win32';
      const pingCommand = 'ping';
      const pingArgs = isWindows
        ? ['-n', '1', '-w', String(this.#timeout), this.#host]
        : ['-c', '1', '-W', String(this.#timeout / 1000), this.#host];

      const child = spawn(pingCommand, pingArgs);
      let stdout = '';
      let stderr = ''; // Keep stderr for logging if needed, but not for success/failure logic

      child.stdout.on('data', data => {
        stdout += data.toString();
      });

      child.stderr.on('data', data => {
        stderr += data.toString();
      });

      child.on('error', err => {
        // Log spawn errors, but don't treat as packet loss directly
        // The 'close' event with a non-zero code will handle actual loss
        console.error(
          `PingDataConnection: Spawn error for msg ${msg}: ${err.message}`
        ); // Re-add error logging
      });

      child.on('close', code => {
        let alive = false;
        let time = null; // Change to null for consistency

        if (code === 0) {
          // Ping successful exit code
          alive = true;

          // Parse output for time from the summary line (e.g., "round-trip min/avg/max/stddev = 13.775/19.479/24.519/3.814 ms")
          const match = stdout.match(
            /round-trip min\/avg\/max\/stddev = \d+\.?\d*\/(\d+\.?\d*)/
          );
          if (match && match[1]) {
            time = parseFloat(match[1]);
          }
        }

        // Call onMessageReceived with detailed result
        this.onMessageReceived(msg, { alive, time, code, stdout, stderr });

        this.#activeRequests--; // Decrement active requests here
        this.#processQueue(); // Process queue after request finishes
      });
    }, jitter);
  }

  #processQueue() {
    if (this.#closed) return;

    // Process pending requests in FIFO order
    while (
      this.#pendingRequests.length > 0 &&
      this.#activeRequests < this.#maxConcurrent
    ) {
      const { msg } = this.#pendingRequests.shift();
      this.#sendPing(msg);
    }
  }

  // Internal state
  #established = false;
  #closed = false;
  #host;
  #timeout;
  #maxConcurrent;
  #batchDelay;
  #options;
  #pendingRequests;
  #activeRequests;
}
