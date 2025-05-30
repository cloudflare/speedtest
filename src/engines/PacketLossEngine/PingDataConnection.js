import ping from 'ping';

export default class PingDataConnection {
  constructor({
    host = 'speed.cloudflare.com',
    timeout = 1000, // 1 second timeout for ping
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
    // const startTime = performance.now(); // Removed unused variable

    // Add small random delay to prevent ping flooding
    const jitter = Math.random() * this.#batchDelay;

    setTimeout(async () => {
      if (this.#closed) {
        this.#activeRequests--;
        return;
      }

      try {
        // Send ICMP ping
        const result = await ping.promise.probe(this.#host, {
          timeout: this.#timeout / 1000, // ping package expects seconds
          extra: ['-c', '1'], // Send only 1 packet
          ...this.#options
        });

        this.#finishRequest(msg, result.alive);
      } catch {
        // Ping failed - treat as packet loss
        this.#finishRequest(msg, false);
      }
    }, jitter);
  }

  #finishRequest(msg, success) {
    this.#activeRequests--;

    if (success && !this.#closed) {
      // Simulate message echo (like WebRTC does)
      this.onMessageReceived(msg);
    }
    // If not successful, we don't call onMessageReceived - this represents real packet loss

    this.#processQueue();
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
