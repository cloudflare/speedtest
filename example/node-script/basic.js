// import SpeedTest from "@cloudflare/speedtest";
import SpeedTest from '../../dist/speedtest.js';

// import { performance } from "perf_hooks";
// global.performance = performance;

const engine = new SpeedTest({
  measurements: [
    // { type: 'latency', numPackets: 1 },
    { type: 'download', bytes: 1e6, count: 1 }
    // { type: 'upload', bytes: 1e4, count: 1 }
  ]
});

// engine.onResultsChange = console.log;

engine.onResultsChange = ({ type }) => {
  console.log(type);
};
engine.onFinish = results => {
  console.log(JSON.stringify(results.raw, null, 2), results.getSummary());
};
