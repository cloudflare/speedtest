import SelfWebRtcDataConnection from './SelfWebRtcDataConnection';
import type { Engine } from '../Engine';
import type { PacketLossResults } from '../../types';

export type { PacketLossResults };

export interface TurnServerCredsApiResult {
  username?: string;
  credential?: string;
  server?: string;
  error?: string;
  [key: string]: unknown;
}

export interface TurnServerCreds {
  turnServerUser?: string;
  turnServerPass?: string;
  turnServerUri?: string;
}

export interface PacketLossEngineOptions {
  turnServerUri?: string;
  turnServerCredsApi?: string;
  turnServerCredsApiParser?: (
    data: TurnServerCredsApiResult
  ) => TurnServerCreds;
  turnServerCredsApiIncludeCredentials?: boolean;
  turnServerUser?: string;
  turnServerPass?: string;
  numMsgs?: number;
  batchSize?: number;
  batchWaitTime?: number;
  responsesWaitTime?: number;
  connectionTimeout?: number;
}

/**
 * Measures packet loss by sending numbered messages through a WebRTC TURN
 * data channel. Fetches temporary TURN credentials from an API endpoint,
 * establishes a loopback data channel via SelfWebRtcDataConnection, then
 * sends messages in configurable batches and counts how many are echoed back.
 */
export default class PacketLossEngine implements Engine {
  constructor({
    turnServerUri,
    turnServerCredsApi,
    turnServerCredsApiParser = ({
      username,
      credential,
      server
    }: TurnServerCredsApiResult): TurnServerCreds => ({
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
  }: PacketLossEngineOptions = {}) {
    if (!turnServerUri && !turnServerCredsApi)
      throw new Error('Missing turnServerCredsApi or turnServerUri argument');

    if ((!turnServerUser || !turnServerPass) && !turnServerCredsApi)
      throw new Error(
        'Missing either turnServerCredsApi or turnServerUser+turnServerPass arguments'
      );

    this.#numMsgs = numMsgs;

    (!turnServerUser || !turnServerPass
      ? // Get TURN credentials from API endpoint if not statically supplied
        fetch(turnServerCredsApi!, {
          credentials: turnServerCredsApiIncludeCredentials
            ? 'include'
            : undefined
        })
          .then(r => r.json())
          .then((d: TurnServerCredsApiResult) => {
            if (d.error) throw d.error;
            return d;
          })
          .then(turnServerCredsApiParser)
      : Promise.resolve({
          turnServerUser,
          turnServerPass
        } as TurnServerCreds)
    )
      .catch(e => this.#onCredentialsFailure(e as string))
      .then((creds?: TurnServerCreds | void) => {
        if (!creds) return;
        const {
          turnServerUser: credsUser,
          turnServerPass: credsPass,
          turnServerUri: credsApiTurnServerUri
        } = creds;

        const c = new SelfWebRtcDataConnection({
          iceServers: [
            {
              urls: `turn:${credsApiTurnServerUri || turnServerUri}?transport=udp`,
              username: credsUser,
              credential: credsPass
            }
          ],
          iceTransportPolicy: 'relay'
        });

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
          (function sendNum(n: number) {
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
              c.onMessageReceived = (msg: string) => {
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
        c.onMessageReceived = (msg: string) => {
          msgTracker[msg] = true;
          this.onMsgReceived(msg);
        };
      })
      .catch(e => this.#onConnectionError((e as Error).toString()));
  }

  // Public attributes
  #onCredentialsFailure: (error: string) => void = () => {}; // Invoked when unable to fetch TURN server credentials
  set onCredentialsFailure(f: (error: string) => void) {
    this.#onCredentialsFailure = f;
  }
  #onConnectionError: (error: string) => void = () => {}; // Invoked when unable to establish a connection with TURN server
  set onConnectionError(f: (error: string) => void) {
    this.#onConnectionError = f;
  }
  #onFinished: (results: PacketLossResults) => void = () => {}; // Invoked when the packet loss measurement is complete
  set onFinished(f: (results: PacketLossResults) => void) {
    this.#onFinished = f;
  }
  onMsgSent: (n: number) => void = () => {}; // Invoked when sending a new message to the TURN server
  onAllMsgsSent: (count: number) => void = () => {}; // Invoked when all messages have been sent
  onMsgReceived: (msg: string) => void = () => {}; // Invoked when receiving a new message from the TURN server

  get results(): PacketLossResults {
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
  #msgTracker: Record<string, boolean> = {};
  #numMsgs: number;
}
