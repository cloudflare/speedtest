import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { speedtest: 'src/index.ts' },
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  dts: true,
  outputOptions: {
    entryFileNames: '[name].js',
    comments: false
  }
});
