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
    batchWaitTime = 10, // ms (in between batches)
    responsesWaitTime = 5000, // ms (debounced time after last msg without any response)
    connectionTimeout = 5000 // ms
  } = {}) {
    // Skip TURN server validation for ping-based connections (Node.js)
    const isNodeJs =
      typeof window === 'undefined' && typeof process !== 'undefined';

    if (!isNodeJs) {
      if (!turnServerUri && !turnServerCredsApi)
        throw new Error('Missing turnServerCredsApi or turnServerUri argument');

      if ((!turnServerUser || !turnServerPass) && !turnServerCredsApi)
        throw new Error(
          'Missing either turnServerCredsApi or turnServerUser+turnServerPass arguments'
        );
    }

    this.#numMsgs = numMsgs;

    // For Node.js (ping), skip credential fetching and use simpler connection config
    const credentialsPromise = isNodeJs
      ? Promise.resolve({ host: turnServerUri || 'speed.cloudflare.com' })
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
      .catch(e => this.#onCredentialsFailure(e))
      .then(credentials => {
        const connectionConfig = isNodeJs
          ? { host: credentials.host || 'speed.cloudflare.com' }
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
                msgTracker[i] = false;
                c.send(i);
                self.onMsgSent(i);
                i++;
              }
              setTimeout(() => sendNum(i), batchWaitTime);
            } else {
              self.onAllMsgsSent(Object.keys(msgTracker).length);

              const finishFn = () => {
                c.close();
                self.#onFinished(self.results);
              };
              let finishTimeout = setTimeout(finishFn, responsesWaitTime);

              let missingMsgs = Object.values(self.#msgTracker).filter(
                recv => !recv
              ).length;
              c.onMessageReceived = msg => {
                clearTimeout(finishTimeout);

                msgTracker[msg] = true;
                self.onMsgReceived(msg);

                missingMsgs--;
                if (
                  missingMsgs <= 0 &&
                  Object.values(self.#msgTracker).every(recv => recv)
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
        c.onMessageReceived = msg => {
          msgTracker[msg] = true;
          this.onMsgReceived(msg);
        };
      });
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
      .filter(([, recv]) => !recv)
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
