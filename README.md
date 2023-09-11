Cloudflare Speedtest
====================

[![NPM package][npm-img]][npm-url]
[![Build Size][build-size-img]][build-size-url]
[![NPM Downloads][npm-downloads-img]][npm-downloads-url]

`@cloudflare/speedtest` is a JavaScript module to measure the quality of a client’s Internet connection. It's the measurement engine that powers the Cloudflare speedtest measurement application available at [https://speed.cloudflare.com](https://speed.cloudflare.com).

The module performs test requests against the [Cloudflare](https://www.cloudflare.com/) edge network and relies on the [PerformanceResourceTiming browser api](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming) to extract timing results.
The network connection is characterized by items such as download/upload bandwidth, latency and packet loss.

Please note that measurement results are collected by Cloudflare on completion for the purpose of calculating aggregated insights regarding Internet connection quality. 

## Installation

Add this package to your `package.json` by running this in the root of your project's directory:

```
npm i @cloudflare/speedtest
```

## Simple Usage

```js
import SpeedTest from '@cloudflare/speedtest';

new SpeedTest().onFinish = results => console.log(results.getSummary());
```

## API reference

`SpeedTest` is a JavaScript Class and should be instantiated with the `new` keyword. It's not required to pass a config object, as all items have default values.

### Instantiation
```js
new SpeedTest({ configOptions })
```

| Config option | Description | Default |
| --- | --- | :--: |
| <b>autoStart</b>: <i>boolean</i> | Whether to automatically start the measurements on instantiation. | `true` |
| <b>downloadApiUrl</b>: <i>string</i> | The URL of the API for performing download GET requests. | `https://speed.cloudflare.com/__down` |
| <b>uploadApiUrl</b>: <i>string</i> | The URL of the API for performing upload POST requests. | `https://speed.cloudflare.com/__up` |
| <b>turnServerUri</b>: <i>string</i> | The URI of the TURN server used to measure packet loss. | `turn.speed.cloudflare.com:50000` |
| <b>turnServerUser</b>: <i>string</i> | The username for the TURN server credentials. | - |
| <b>turnServerPass</b>: <i>string</i> | The password for the TURN server credentials. | - |
| <b>measurements</b>: <i>array</i> | The sequence of measurements to perform by the speedtest engine. See [below](#measurement-config) for the specific syntax of this option. ||
| <b>measureDownloadLoadedLatency</b>: <i>boolean</i> | Whether to perform additional latency measurements simultaneously with download requests, to measure loaded latency (during download). | `true` |
| <b>measureUploadLoadedLatency</b>: <i>boolean</i> | Whether to perform additional latency measurements simultaneously with upload requests, to measure loaded latency (during upload). | `true` |
| <b>loadedLatencyThrottle</b>: <i>number</i> | Time interval to wait in between loaded latency requests (in milliseconds). | 400 |
| <b>bandwidthFinishRequestDuration</b>: <i>number</i> | The minimum duration (in milliseconds) to reach in download/upload measurement sets for halting further measurements with larger file sizes in the same direction. | 1000 |
| <b>estimatedServerTime</b>: <i>number</i> | If the download/upload APIs do not return a server-timing response header containing the time spent in the server, this fixed value (in milliseconds) will be subtracted from all time-to-first-byte calculations. | 10 |
| <b>latencyPercentile</b>: <i>number</i> | The percentile (between 0 and 1) used to calculate latency from a set of measurements. | 0.5 |
| <b>bandwidthPercentile</b>: <i>number</i> | The percentile (between 0 and 1) used to calculate bandwidth from a set of measurements. | 0.9 |
| <b>bandwidthMinRequestDuration</b>: <i>number</i> | The minimum duration (in milliseconds) of a request to consider a measurement good enough to use in the bandwidth calculation. | 10 |
| <b>loadedRequestMinDuration</b>: <i>number</i> | The minimum duration (in milliseconds) of a request to consider it to be loading the connection. | 250 |
| <b>loadedLatencyMaxPoints</b>: <i>number</i> | The maximum number of data points to keep for loaded latency measurements. When more than this amount are available, the latest ones are kept. | 20 |

### Attributes
| Attribute | Description |
| --- | --- |
| <b>results</b>: <i>[Results](#results-object)</i> | Getter of the current [test results](#results-object) object. May yield incomplete values if the test is still running. |
| <b>isRunning</b>: <i>boolean</i> | Getter of whether the test engine is currently running. |
| <b>isFinished</b>: <i>boolean</i> | Getter of whether the test engine has finished all the measurements, and the results are considered final. |

### Methods
| Method | Description |
| --- | --- |
| <b>play()</b> | Starts or resumes the measurements. Does nothing if the engine is already running or is finished. |
| <b>pause()</b> | Pauses the measurements. Does nothing if the engine is already paused or is finished. |
| <b>restart()</b> | Clears the current results and restarts the measurements from the beginning. |

### Notification Events
| Event Method           | Arguments                                  | Description |
|------------------------|--------------------------------------------| :--: |
| <b>onRunningChange</b> | running: <i>boolean</i>                    | Invoked whenever the test engine starts or stops. The current state is included as a function argument. |
| <b>onResultsChange</b> | { type: <i>string</i> }                    | Invoked whenever any item changes in the results, usually indicating the completion of a measurement. The type of measurement that changed is included as an info attribute in the function argument. |
| <b>onFinish</b>        | results: <i>[Results](#results-object)</i> | Invoked whenever the test engine finishes all the measurements. The final [results object](#results-object) is included as a function argument. |
| <b>onError</b>         | error: <i>string</i>                       | Invoked whenever an error occurs during one of the measurements. The error details are included as a function argument. |

### Measurement config
The specific measurements to be performed by the test engine (and their sequence) can be customized using the `measurements` config option. This should be an array of objects, each with a `type` field, plus additional fields specific to that measurement type.

The default set of measurements that is performed by the engine is:
```js
[
  { type: 'latency', numPackets: 1 }, // initial latency estimation
  { type: 'download', bytes: 1e5, count: 1, bypassMinDuration: true }, // initial download estimation
  { type: 'latency', numPackets: 20 },
  { type: 'download', bytes: 1e5, count: 9 },
  { type: 'download', bytes: 1e6, count: 8 },
  { type: 'upload', bytes: 1e5, count: 8 },
  { type: 'packetLoss', numPackets: 1e3, responsesWaitTime: 3000 },
  { type: 'upload', bytes: 1e6, count: 6 },
  { type: 'download', bytes: 1e7, count: 6 },
  { type: 'upload', bytes: 1e7, count: 4 },
  { type: 'download', bytes: 2.5e7, count: 4 },
  { type: 'upload', bytes: 2.5e7, count: 4 },
  { type: 'download', bytes: 1e8, count: 3 },
  { type: 'upload', bytes: 5e7, count: 3 },
  { type: 'download', bytes: 2.5e8, count: 2 }
]
```

Here are the fields available per measurement type:

#### latency
| Field | Required | Description | Default |
| --- | :--: | --- | :--: |
| <b>numPackets</b>: <i>number</i> | yes | The number of latency GET requests to perform. These requests are performed against the download API with `bytes=0`, and then the round-trip time-to-first-byte timing between `requestStart` and `responseStart` is extracted. | - |

#### download / upload
Each of these measurement sets are bound to a specific file size. The engine follows a ramp-up methodology per direction (download or upload). Whenever there are multiple measurement sets (with increasing file sizes) for a direction, the engine will keep on performing them until it reaches the condition specified by `bandwidthMinRequestDuration`, at which point further sets in the same direction are ignored.

| Field | Required | Description | Default |
| --- | :--: | --- | :--: |
| <b>bytes</b>: <i>number</i> | yes | The file size to request from the download API, or post to the upload API. The bandwidth (calculated as bits per second, or bps) for each request is calculated by dividing the `transferSize` (in bits) by the request duration (excluding the server processing time). | - |
| <b>count</b>: <i>number</i> | yes | The number of requests to perform for this file size. | - |
| <b>bypassMinDuration</b>: <i>boolean</i> | no | Whether the `bandwidthMinRequestDuration` check should be ignored, and the engine is instructed to proceed with the measurements of this direction in any case. | `false` |

#### packetLoss
Packet loss is measured by submitting a set of UDP packets to a WebRTC TURN server in a round-trip fashion, and determining how many packets do not arrive. The submission of these packets can be done in a batching method, in which there's a sleep time in between batches.

| Field | Required | Description | Default |
| --- | :--: | --- | :--: |
| <b>numPackets</b>: <i>number</i> | no | The total number of UDP packets to send. | 100 |
| <b>responsesWaitTime</b>: <i>number</i> | no | The interval of time (in milliseconds) to wait after the latest packet reception before determining the measurement as complete, and all non-returned packets as lost. | 5000 |
| <b>batchSize</b>: <i>number</i> | no | The number of packets in a batch. If this value is higher than `numPackets` there will be only one batch. | 10 |
| <b>batchWaitTime</b>: <i>number</i> | no | How long to wait (in milliseconds) between batches. | 10 |
| <b>connectionTimeout</b>: <i>number</i> | no | Timeout for the connection to the TURN server. | 5000 |

### Results object
An instance object used to access the results of the speedtest measurements. The following methods are available on this object:

| Method | Description |
| --- | --- |
| <b>getSummary()</b> | Returns a high-level summary object with the computed results from the performed measurements. |
| <b>getUnloadedLatency()</b> | Returns the reduced value of the connection latency while at idle. Requires at least one `latency` measurement. |
| <b>getUnloadedJitter()</b> | Returns the connection jitter while at idle. Jitter is calculated as the average distance between consecutive latency measurements. Requires at least two `latency` measurements. |
| <b>getUnloadedLatencyPoints()</b> | Returns an array with all the latencies measured while at idle. Includes one value per measurement in sequence. |
| <b>getDownLoadedLatency()</b> | Returns the reduced value of the connection latency while loaded in the download direction. Requires `measureDownloadLoadedLatency` to be enabled. |
| <b>getDownLoadedJitter()</b> | Returns the connection jitter while loaded in the download direction. Requires `measureDownloadLoadedLatency` to be enabled, and at least two loaded latency measurements. |
| <b>getDownLoadedLatencyPoints()</b> | Returns an array with all the latencies measured while loaded in the download direction. Includes one value per loaded measurement in sequence. Requires `measureDownloadLoadedLatency` to be enabled. |
| <b>getUpLoadedLatency()</b> | Returns the reduced value of the connection latency while loaded in the upload direction. Requires `measureUploadLoadedLatency` to be enabled. |
| <b>getUpLoadedJitter()</b> | Returns the connection jitter while loaded in the upload direction. Requires `measureUploadLoadedLatency` to be enabled, and at least two loaded latency measurements. |
| <b>getUpLoadedLatencyPoints()</b> | Returns an array with all the latencies measured while loaded in the upload direction. Includes one value per loaded measurement in sequence. Requires `measureUploadLoadedLatency` to be enabled. |
| <b>getDownloadBandwidth()</b> | Returns the reduced value of the download bandwidth (in bps). Requires at least one `download` measurement, longer than the `bandwidthMinRequestDuration` threshold. |
| <b>getDownloadBandwidthPoints()</b> | Returns an array with all the download measurement results. Each item will include the following fields: `{ bytes, bps, duration, ping, measTime, serverTime, transferSize }`. |
| <b>getUploadBandwidth()</b> | Returns the reduced value of the upload bandwidth (in bps). Requires at least one `upload` measurement, longer than the `bandwidthMinRequestDuration` threshold. |
| <b>getUploadBandwidthPoints()</b> | Returns an array with all the upload measurement results. Each item will include the following fields: `{ bytes, bps, duration, ping, measTime, serverTime, transferSize }`. |
| <b>getPacketLoss()</b> | Returns the reduced value of the measured packet loss ratio (between 0 and 1). Requires a `packetLoss` measurement set. |
| <b>getPacketLossDetails()</b> | Returns an object with the details of the packet loss measurement. Includes the following fields: `{ packetLoss, totalMessages, numMessagesSent, lostMessages }`. Requires a `packetLoss` measurement set. |
| <b>getScores()</b> | Returns the computed [AIM scores](https://developers.cloudflare.com/fundamentals/speed/aim/) that categorize the quality of the network connection according to use cases such as streaming, gaming or real-time communications. This score is only available after the engine has finished performing all of the measurements. |

[npm-img]: https://img.shields.io/npm/v/@cloudflare/speedtest
[npm-url]: https://npmjs.org/package/@cloudflare/speedtest
[build-size-img]: https://img.shields.io/bundlephobia/minzip/@cloudflare/speedtest
[build-size-url]: https://bundlephobia.com/result?p=@cloudflare/speedtest
[npm-downloads-img]: https://img.shields.io/npm/dt/@cloudflare/speedtest
[npm-downloads-url]: https://www.npmtrends.com/@cloudflare/speedtest