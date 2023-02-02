import LoadNetworkEngine from '../LoadNetworkEngine';
import PacketLossEngine from './PacketLossEngine';

class PacketLossUnderLoadEngine extends PacketLossEngine {
  constructor({
    downloadChunkSize,
    uploadChunkSize,
    downloadApiUrl,
    uploadApiUrl,
    ...ptProps
  } = {}) {
    super(ptProps);

    if (downloadChunkSize || uploadChunkSize) {
      this.#loadEngine = new LoadNetworkEngine({
        download: downloadChunkSize
          ? {
              apiUrl: downloadApiUrl,
              chunkSize: downloadChunkSize
            }
          : null,
        upload: uploadChunkSize
          ? {
              apiUrl: uploadApiUrl,
              chunkSize: uploadChunkSize
            }
          : null
      });

      super.onCredentialsFailure =
        super.onConnectionError =
        super.onFinished =
          () => this.#loadEngine.stop();
    }
  }

  // Overridden attributes
  set qsParams(qsParams) {
    this.#loadEngine && (this.#loadEngine.qsParams = qsParams);
  }

  set fetchOptions(fetchOptions) {
    this.#loadEngine && (this.#loadEngine.fetchOptions = fetchOptions);
  }

  set onCredentialsFailure(onCredentialsFailure) {
    super.onCredentialsFailure = (...args) => {
      onCredentialsFailure(...args);
      this.#loadEngine && this.#loadEngine.stop();
    };
  }

  set onConnectionError(onConnectionError) {
    super.onConnectionError = (...args) => {
      onConnectionError(...args);
      this.#loadEngine && this.#loadEngine.stop();
    };
  }

  set onFinished(onFinished) {
    super.onFinished = (...args) => {
      onFinished(...args);
      this.#loadEngine && this.#loadEngine.stop();
    };
  }

  // Internal state
  #loadEngine;
}

export default PacketLossUnderLoadEngine;
