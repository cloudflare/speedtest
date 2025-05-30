import SpeedTest from './dist/speedtest.js';

async function runPacketLossTest() {
  console.log('Starting packet loss test...');

  const speedtest = new SpeedTest({
    autoStart: false,
    measurements: [{ type: 'packetLoss', numPackets: 100, batchSize: 10 }]
  });

  speedtest.onResultsChange = ({ type }) => {
    const measurement = speedtest.results.raw[type];
    if (measurement?.finished) {
      console.log(`Completed ${type} measurement.`);
    } else if (measurement?.started) {
      console.log(`Starting ${type} measurement...`);
    }
  };

  speedtest.onError = error => {
    console.error(`Measurement failed: ${error}`);
  };

  speedtest.onFinish = results => {
    console.log('\n--- Packet Loss Test Results ---');
    console.log(
      'Total Messages Sent:',
      results.getPacketLossDetails()?.numMessagesSent
    );
    console.log(
      'Lost Messages:',
      results.getPacketLossDetails()?.lostMessages.length
    );
    console.log('Packet Loss (%):', results.getPacketLoss());
    console.log('--------------------------------');
  };

  speedtest.play();
}

runPacketLossTest().catch(console.error);
