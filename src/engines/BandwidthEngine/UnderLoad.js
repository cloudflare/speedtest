import LoadNetworkEngine from '../LoadNetworkEngine';
import BandwidthEngine from './BandwidthEngine';

class BandwidthUnderLoadEngine extends BandwidthEngine {
  constructor(
    measurements,
    {
      downloadChunkSize,
      uploadChunkSize,
      downloadApiUrl,
      uploadApiUrl,
      ...ptProps
    } = {}
  ) {
    super(measurements, { downloadApiUrl, uploadApiUrl, ...ptProps });

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

      super.onRunningChange = running => {
        this.#loadEngine[running ? 'play' : 'pause']();
      };

      super.onConnectionError = () => this.#loadEngine.stop();
    }
  }

  // Overridden attributes
  get qsParams() {
    return super.qsParams;
  }
  set qsParams(qsParams) {
    super.qsParams = qsParams;
    this.#loadEngine && (this.#loadEngine.qsParams = qsParams);
  }

  get fetchOptions() {
    return super.fetchOptions;
  }
  set fetchOptions(fetchOptions) {
    super.fetchOptions = fetchOptions;
    this.#loadEngine && (this.#loadEngine.fetchOptions = fetchOptions);
  }

  set onRunningChange(onRunningChange) {
    super.onRunningChange = running => {
      onRunningChange(running);
      this.#loadEngine && this.#loadEngine[running ? 'play' : 'pause']();
    };
  }

  // get onConnectionError() {
  //   return super.onConnectionError;
  // }
  set onConnectionError(onConnectionError) {
    super.onConnectionError = (...args) => {
      onConnectionError(...args);
      this.#loadEngine && this.#loadEngine.stop();
    };
  }

  // Overridden methods
  pause() {
    super.pause();
    this.#loadEngine && this.#loadEngine.pause();
  }

  play() {
    super.play();
    this.#loadEngine && this.#loadEngine.play();
  }

  // Internal state
  #loadEngine;
}

export default BandwidthUnderLoadEngine;
