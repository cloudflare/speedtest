import babel from '@rollup/plugin-babel';
import resolve from '@rollup/plugin-node-resolve';
import dts from 'rollup-plugin-dts';

import pkg from './package.json' assert { type: 'json' };
const { name, dependencies } = pkg;

const fileName = name.split('/').slice(-1);

export default [
  { // ESM
    input: 'src/index.js',
    output: [
      {
        format: 'es',
        file: `dist/${fileName}.js`
      }
    ],
    external: [
      ...Object.keys(dependencies || {})
    ],
    plugins: [
      babel({ babelHelpers: "bundled" }),
      resolve()
    ]
  },
  { // expose TS declarations
    input: 'src/index.d.ts',
    output: [{
      file: `dist/${fileName}.d.ts`,
      format: 'es'
    }],
    plugins: [dts()],
  }
];