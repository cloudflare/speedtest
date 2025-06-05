import PingDataConnection from './PingDataConnection';
import SelfWebRtcDataConnection from './SelfWebRtcDataConnection';

// Determines if the environment supports ping-based connections (Node.js) or requires WebRTC (browser)
const DataConnection =
  typeof window === 'undefined' && typeof process !== 'undefined'
    ? PingDataConnection
    : SelfWebRtcDataConnection;

export default class PacketLossEngine {
  constructor({
    turnServerUri,
    turnServerCredsApi,
    turnServerCredsApiParser = ({ username, credential, server }) => ({
      turnServerUser: username,
      turnServerPass: credential,
      turnServerUri: server
    }),
    turnServerCredsApiIncludeCredentials = false,
    turnServerUser,
    turnServerPass,
    numMsgs = 100,
    batchSize = 10,
    batchWaitTime = 10,
    responsesWaitTime = 5000, // ms (debounced time after last msg without any response)
    connectionTimeout = 5000, // ms
    pingHost = 'speed.cloudflare.com',
    pingTimeout = 5000,
    pingMaxConcurrent = 10
  } = {}) {
    // Check if the current environment is suitable for ping-based connections (Node.js)
    const isPingBasedConnection =
      typeof window === 'undefined' && typeof process !== 'undefined';

    // Skip TURN server validation for ping-based connections (Node.js)
    if (!isPingBasedConnection) {
      if (!turnServerUri && !turnServerCredsApi)
        throw new Error('Missing turnServerCredsApi or turnServerUri argument');

      if ((!turnServerUser || !turnServerPass) && !turnServerCredsApi)
        throw new Error(
          'Missing either turnServerCredsApi or turnServerUser+turnServerPass arguments'
        );
    }

    this.#numMsgs = numMsgs;

    // Adjust responsesWaitTime for Node.js if pingTimeout is larger
    if (isPingBasedConnection) {
      responsesWaitTime = Math.max(responsesWaitTime, pingTimeout);
    }

    // For Node.js (ping), directly resolve the promise with the specified or default host for ICMP
    const credentialsPromise = isPingBasedConnection
      ? Promise.resolve({})
      : !turnServerUser || !turnServerPass
        ? // Get TURN credentials from API endpoint if not statically supplied
          fetch(turnServerCredsApi, {
            credentials: turnServerCredsApiIncludeCredentials
              ? 'include'
              : undefined
          })
            .then(r => r.json())
            .then(d => {
              if (d.error) throw d.error;
              return d;
            })
            .then(turnServerCredsApiParser)
        : Promise.resolve({
            turnServerUser,
            turnServerPass
          });

    credentialsPromise
      .catch(e => {
        this.#onCredentialsFailure(e);
      })
      .then(credentials => {
        const connectionConfig = isPingBasedConnection
          ? {
              host: pingHost,
              timeout: pingTimeout,
              maxConcurrent: pingMaxConcurrent
            }
          : {
              iceServers: [
                {
                  urls: `turn:${credentials.turnServerUri || turnServerUri}?transport=udp`,
                  username: credentials.turnServerUser,
                  credential: credentials.turnServerPass
                }
              ],
              iceTransportPolicy: 'relay'
            };

        const c = (this.#webRtcConnection = new DataConnection(
          connectionConfig
        ));

        let connectionSuccess = false;
        setTimeout(() => {
          if (!connectionSuccess) {
            c.close();
            this.#onConnectionError('ICE connection timeout!');
          }
        }, connectionTimeout);

        const msgTracker = this.#msgTracker;
        const individualPingDelay = Math.max(
          Math.floor(batchWaitTime / batchSize),
          1
        );

        c.onOpen = () => {
          connectionSuccess = true;
          const self = this;
          (function sendNum(n) {
            if (n <= numMsgs) {
              msgTracker[n] = {
                sent: true,
                received: false,
                time: null,
                raw: null
              };
              c.send(n);
              self.onMsgSent(n);
              setTimeout(() => sendNum(n + 1), individualPingDelay);
            } else {
              self.onAllMsgsSent(Object.keys(msgTracker).length);

              const finishFn = () => {
                c.close();
                self.#onFinished(self.results);
              };
              let finishTimeout = setTimeout(finishFn, responsesWaitTime);

              let missingMsgs = Object.values(self.#msgTracker).filter(
                d => !d.received
              ).length;
              c.onMessageReceived = (msg, data) => {
                clearTimeout(finishTimeout);

                msgTracker[msg] = {
                  ...msgTracker[msg],
                  received: data.alive,
                  time: data.time,
                  raw: data.stdout
                };
                self.onMsgReceived(msg);

                missingMsgs--;
                if (
                  missingMsgs <= 0 &&
                  Object.values(self.#msgTracker).every(d => d.received)
                ) {
                  finishFn();
                } else {
                  finishTimeout = setTimeout(finishFn, responsesWaitTime);
                }
              };
            }
          })(1);
        };
        c.onMessageReceived = (msg, data) => {
          msgTracker[msg] = {
            ...msgTracker[msg],
            received: data.alive,
            time: data.time,
            raw: data.stdout
          };
          this.onMsgReceived(msg);
        };
      })
      .catch(e => this.#onConnectionError(e.toString()));
  }

  // Public attributes
  #onCredentialsFailure = () => {}; // Invoked when unable to fetch TURN server credentials
  set onCredentialsFailure(f) {
    this.#onCredentialsFailure = f;
  }
  #onConnectionError = () => {}; // Invoked when unable to establish a connection with TURN server
  set onConnectionError(f) {
    this.#onConnectionError = f;
  }
  #onFinished = () => {}; // Invoked when the packet loss measurement is complete
  set onFinished(f) {
    this.#onFinished = f;
  }
  onMsgSent = () => {}; // Invoked when sending a new message to the TURN server
  onAllMsgsSent = () => {}; // Invoked when all messages have been sent
  onMsgReceived = () => {}; // Invoked when receiving a new message from the TURN server

  get results() {
    const totalMessages = this.#numMsgs;
    const numMessagesSent = Object.keys(this.#msgTracker).length;
    const lostMessages = Object.entries(this.#msgTracker)
      .filter(([, data]) => !data.received) // Filter based on 'received' property
      .map(([n]) => +n);
    const packetLoss = lostMessages.length / numMessagesSent;
    return { totalMessages, numMessagesSent, packetLoss, lostMessages };
  }

  // Public methods

  // Internal state
  #msgTracker = {};
  #webRtcConnection;
  #numMsgs;
}
