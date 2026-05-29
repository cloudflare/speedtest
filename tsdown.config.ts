import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { speedtest: 'src/index.js' },
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  dts: false,
  outputOptions: {
    entryFileNames: '[name].js'
  }
});
