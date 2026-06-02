import LoadNetworkEngine from '../LoadNetworkEngine';
import PacketLossEngine from './PacketLossEngine';
import type {
  PacketLossEngineOptions,
  PacketLossResults
} from './PacketLossEngine';

export interface PacketLossUnderLoadOptions extends PacketLossEngineOptions {
  downloadChunkSize?: number;
  uploadChunkSize?: number;
  downloadApiUrl?: string;
  uploadApiUrl?: string;
}

/**
 * Extends PacketLossEngine to run under artificial network load.
 * Starts a LoadNetworkEngine alongside the packet loss measurement to
 * saturate the connection, simulating real-world congested conditions.
 */
class PacketLossUnderLoadEngine extends PacketLossEngine {
  constructor({
    downloadChunkSize,
    uploadChunkSize,
    downloadApiUrl,
    uploadApiUrl,
    ...ptProps
  }: PacketLossUnderLoadOptions = {}) {
    super(ptProps);

    if (downloadChunkSize || uploadChunkSize) {
      this.#loadEngine = new LoadNetworkEngine({
        download: downloadChunkSize
          ? {
              apiUrl: downloadApiUrl!,
              chunkSize: downloadChunkSize
            }
          : null,
        upload: uploadChunkSize
          ? {
              apiUrl: uploadApiUrl!,
              chunkSize: uploadChunkSize
            }
          : null
      });

      super.onCredentialsFailure =
        super.onConnectionError =
        super.onFinished =
          () => this.#loadEngine!.stop();
    }
  }

  // Overridden attributes
  set qsParams(qsParams: Record<string, string>) {
    this.#loadEngine && (this.#loadEngine.qsParams = qsParams);
  }

  set fetchOptions(fetchOptions: RequestInit) {
    this.#loadEngine && (this.#loadEngine.fetchOptions = fetchOptions);
  }

  set onCredentialsFailure(onCredentialsFailure: (error: string) => void) {
    super.onCredentialsFailure = (...args: [string]) => {
      onCredentialsFailure(...args);
      this.#loadEngine && this.#loadEngine.stop();
    };
  }

  set onConnectionError(onConnectionError: (error: string) => void) {
    super.onConnectionError = (...args: [string]) => {
      onConnectionError(...args);
      this.#loadEngine && this.#loadEngine.stop();
    };
  }

  set onFinished(onFinished: (results: PacketLossResults) => void) {
    super.onFinished = (...args: [PacketLossResults]) => {
      onFinished(...args);
      this.#loadEngine && this.#loadEngine.stop();
    };
  }

  // Internal state
  #loadEngine: LoadNetworkEngine | undefined;
}

export default PacketLossUnderLoadEngine;
