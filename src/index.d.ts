export interface ConfigOptions {
  autoStart?: boolean;
}

declare class SpeedTestEngine {
  constructor(config?: ConfigOptions);

  play: () => void;
  pause: () => void;
  restart: () => void;
}

export default SpeedTestEngine;