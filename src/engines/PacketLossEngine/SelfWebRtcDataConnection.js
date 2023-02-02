export default class SelfWebRtcDataConnection {
  constructor({
    iceServers = [],
    acceptIceCandidate = candidate => {
      let protocol = candidate.protocol || '';
      // parsed webRTC candidate properties not extracted in Firefox: https://developer.mozilla.org/en-US/docs/Web/API/RTCIceCandidate
      if (!protocol && candidate.candidate) {
        const sdpAttrs = candidate.candidate.split(' ');
        sdpAttrs.length >= 3 && (protocol = sdpAttrs[2]);
      }
      return protocol.toLowerCase() === 'udp';
    },
    dataChannelCfg = {
      ordered: false,
      maxRetransmits: 0
    },
    ...rtcPeerConnectionCfg
  } = {}) {
    const sender = new RTCPeerConnection({
      iceServers,
      ...rtcPeerConnectionCfg
    });
    const receiver = new RTCPeerConnection({
      iceServers,
      ...rtcPeerConnectionCfg
    });

    let senderDc = sender.createDataChannel('channel', dataChannelCfg);
    senderDc.onopen = () => {
      this.#established = true;
      this.onOpen();
    };
    senderDc.onclose = () => this.close();
    // senderDc.onmessage = msg => this.#onMessage(msg.data);

    receiver.ondatachannel = e => {
      const dc = e.channel;
      dc.onclose = () => this.close();
      dc.onmessage = msg => this.onMessageReceived(msg.data);

      this.#receiverDc = dc;
    };

    // sender.onconnectionstatechange = e => console.log('connection state change', e);
    // sender.oniceconnectionstatechange = e => console.log('ice connection state change', e);
    // sender.onicecandidateerror = e => console.log('ice error', e);
    sender.onicecandidate = e => {
      // console.log('sender', e.candidate);
      e.candidate &&
        acceptIceCandidate(e.candidate) &&
        receiver.addIceCandidate(e.candidate);
    };
    receiver.onicecandidate = e => {
      // console.log('receiver', e.candidate);
      e.candidate &&
        acceptIceCandidate(e.candidate) &&
        sender.addIceCandidate(e.candidate);
    };

    sender
      .createOffer()
      .then(offer => sender.setLocalDescription(offer))
      .then(() => receiver.setRemoteDescription(sender.localDescription))
      .then(() => receiver.createAnswer())
      .then(answer => receiver.setLocalDescription(answer))
      .then(() => sender.setRemoteDescription(receiver.localDescription));

    this.#sender = sender;
    this.#receiver = receiver;
    this.#senderDc = senderDc;
    this.#established = false;
  }

  // Public attributes
  onOpen = () => {}; // callback invoked when WebRTC TURN connection is established
  onClose = () => {}; // callback invoked when WebRTC TURN connection is closed
  onMessageReceived = () => {}; // callback invoked when a new message is received from the TURN server

  // Public methods
  send(msg) {
    return this.#senderDc.send(msg);
  }

  close() {
    this.#sender && this.#sender.close();
    this.#receiver && this.#receiver.close();
    this.#senderDc && this.#senderDc.close();
    this.#receiverDc && this.#receiverDc.close();

    this.#established && this.onClose();
    this.#established = false;
    return this;
  }

  // Internal state
  #established = false;

  #sender;
  #receiver;
  #senderDc;
  #receiverDc;
}
