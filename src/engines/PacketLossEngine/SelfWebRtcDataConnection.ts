export interface SelfWebRtcDataConnectionOptions {
  iceServers?: RTCIceServer[];
  acceptIceCandidate?: (candidate: RTCIceCandidate) => boolean;
  dataChannelCfg?: RTCDataChannelInit;
  iceTransportPolicy?: RTCIceTransportPolicy;
  [key: string]: unknown;
}

/**
 * Creates a loopback WebRTC data channel through a TURN relay. Sets up two
 * RTCPeerConnection instances (sender + receiver), exchanges ICE candidates
 * filtered to UDP-only relay candidates, and exposes send/receive callbacks.
 * Used by PacketLossEngine to route messages through the TURN server.
 */
export default class SelfWebRtcDataConnection {
  constructor({
    iceServers = [],
    acceptIceCandidate = (candidate: RTCIceCandidate): boolean => {
      let protocol = candidate.protocol || '';
      // parsed webRTC candidate properties not extracted in Firefox: https://developer.mozilla.org/en-US/docs/Web/API/RTCIceCandidate
      if (!protocol && candidate.candidate) {
        const sdpAttrs = candidate.candidate.split(' ');
        sdpAttrs.length >= 3 && (protocol = sdpAttrs[2] as RTCIceProtocol);
      }
      return protocol.toLowerCase() === 'udp';
    },
    dataChannelCfg = {
      ordered: false,
      maxRetransmits: 0
    },
    ...rtcPeerConnectionCfg
  }: SelfWebRtcDataConnectionOptions = {}) {
    const sender = new RTCPeerConnection({
      iceServers,
      ...rtcPeerConnectionCfg
    } as RTCConfiguration);
    const receiver = new RTCPeerConnection({
      iceServers,
      ...rtcPeerConnectionCfg
    } as RTCConfiguration);

    const senderDc = sender.createDataChannel('channel', dataChannelCfg);
    senderDc.onopen = () => {
      this.#established = true;
      this.onOpen();
    };
    senderDc.onclose = () => this.close();

    receiver.ondatachannel = (e: RTCDataChannelEvent) => {
      const dc = e.channel;
      dc.onclose = () => this.close();
      dc.onmessage = (msg: MessageEvent) =>
        this.onMessageReceived(msg.data as string);

      this.#receiverDc = dc;
    };

    sender.onicecandidate = (e: RTCPeerConnectionIceEvent) => {
      e.candidate &&
        acceptIceCandidate(e.candidate) &&
        receiver.addIceCandidate(e.candidate);
    };
    receiver.onicecandidate = (e: RTCPeerConnectionIceEvent) => {
      e.candidate &&
        acceptIceCandidate(e.candidate) &&
        sender.addIceCandidate(e.candidate);
    };

    sender
      .createOffer()
      .then(offer => sender.setLocalDescription(offer))
      .then(() => receiver.setRemoteDescription(sender.localDescription!))
      .then(() => receiver.createAnswer())
      .then(answer => receiver.setLocalDescription(answer))
      .then(() => sender.setRemoteDescription(receiver.localDescription!));

    this.#sender = sender;
    this.#receiver = receiver;
    this.#senderDc = senderDc;
  }

  // Public attributes
  onOpen: () => void = () => {}; // callback invoked when WebRTC TURN connection is established
  onClose: () => void = () => {}; // callback invoked when WebRTC TURN connection is closed
  onMessageReceived: (msg: string) => void = () => {}; // callback invoked when a new message is received from the TURN server

  // Public methods
  send(msg: string | number): void {
    this.#senderDc.send(String(msg));
  }

  close(): this {
    this.#sender && this.#sender.close();
    this.#receiver && this.#receiver.close();
    this.#senderDc && this.#senderDc.close();
    this.#receiverDc && this.#receiverDc.close();

    this.#established && this.onClose();
    this.#established = false;
    return this;
  }

  // Internal state
  #established: boolean = false;

  #sender: RTCPeerConnection;
  #receiver: RTCPeerConnection;
  #senderDc: RTCDataChannel;
  #receiverDc: RTCDataChannel | undefined;
}
