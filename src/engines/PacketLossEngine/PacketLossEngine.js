import PingDataConnection from './PingDataConnection';
import SelfWebRtcDataConnection from './SelfWebRtcDataConnection';

// Environment detection: use ping in Node.js, WebRTC in browser
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
    batchWaitTime = 100, // Increased from 10ms to 100ms for more stable pinging
    responsesWaitTime = 5000, // ms (debounced time after last msg without any response)
    connectionTimeout = 5000 // ms
  } = {}) {
    // Define isNodeJs at the very beginning of the constructor
    const isNodeJs =
      typeof window === 'undefined' && typeof process !== 'undefined';

    // Skip TURN server validation for ping-based connections (Node.js)
    if (!isNodeJs) {
      if (!turnServerUri && !turnServerCredsApi)
        throw new Error('Missing turnServerCredsApi or turnServerUri argument');

      if ((!turnServerUser || !turnServerPass) && !turnServerCredsApi)
        throw new Error(
          'Missing either turnServerCredsApi or turnServerUser+turnServerPass arguments'
        );
    }

    this.#numMsgs = numMsgs;

    // For Node.js (ping), directly resolve the promise with a fixed host for ICMP
    const credentialsPromise = isNodeJs
      ? Promise.resolve({ host: 'speed.cloudflare.com' }) // Always use speed.cloudflare.com for ICMP
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
        const connectionConfig = isNodeJs
          ? { host: credentials.host } // Use the extracted hostname
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
        c.onOpen = () => {
          connectionSuccess = true;
          const self = this;
          (function sendNum(n) {
            if (n <= numMsgs) {
              let i = n;
              while (i <= Math.min(numMsgs, n + batchSize - 1)) {
                msgTracker[i] = {
                  sent: true,
                  received: false,
                  time: null,
                  raw: null
                }; // Store detailed info
                c.send(i);
                self.onMsgSent(i);
                i++;
              }
              setTimeout(() => sendNum(i), batchWaitTime);
            } else {
              self.onAllMsgsSent(Object.keys(msgTracker).length);

              const finishFn = () => {
                c.close();
                // No need to call self.onMsgReceived(null) here, as it's handled by individual messages
                self.#onFinished(self.results);
              };
              let finishTimeout = setTimeout(finishFn, responsesWaitTime);

              let missingMsgs = Object.values(self.#msgTracker).filter(
                d => !d.received
              ).length; // Check 'received' property
              c.onMessageReceived = (msg, data) => {
                // Accept data object
                clearTimeout(finishTimeout);

                msgTracker[msg] = {
                  ...msgTracker[msg],
                  received: data.alive,
                  time: data.time,
                  raw: data.stdout
                }; // Update with received data
                self.onMsgReceived(msg); // This calls the public onMsgReceived, which updates results in MeasurementEngine

                missingMsgs--;
                if (
                  missingMsgs <= 0 &&
                  Object.values(self.#msgTracker).every(d => d.received) // Check 'received' property
                ) {
                  // Last msg received, shortcut out
                  finishFn();
                } else {
                  // restart timeout
                  finishTimeout = setTimeout(finishFn, responsesWaitTime);
                }
              };
            }
          })(1);
        };
        c.onMessageReceived = (msg, data) => {
          // Accept data object
          msgTracker[msg] = {
            ...msgTracker[msg],
            received: data.alive,
            time: data.time,
            raw: data.stdout
          }; // Update with received data
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
