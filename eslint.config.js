import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import compat from 'eslint-plugin-compat';
import json from 'eslint-plugin-json';
import prettier from 'eslint-plugin-prettier';

export default [
  // Base configuration
  js.configs.recommended,
  ...tseslint.configs.recommended,
  compat.configs['flat/recommended'],
  json.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tseslint.parser,
      parserOptions: {
        projectService: true
      }
    },
    plugins: {
      prettier: prettier
    },
    rules: {
      'no-unused-private-class-members': 'off',
      'no-prototype-builtins': 'off',
      'default-case': 'error',
      eqeqeq: 'error',
      'guard-for-in': 'error',
      'no-self-compare': 'error',
      'no-void': 'error',
      radix: 'error',
      'wrap-iife': ['error', 'inside'],

      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' }
      ],
      // Allow short-circuit expressions (e.g., `expr && fn()`) — common pattern in this codebase
      '@typescript-eslint/no-unused-expressions': [
        'error',
        { allowShortCircuit: true }
      ],
      // Allow `const self = this` pattern (used in PacketLossEngine's IIFE)
      '@typescript-eslint/no-this-alias': 'off',
      // Enforce `import type` for type-only imports (helps tree-shaking and clarity)
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' }
      ],

      'prettier/prettier': 'error'
    },
    settings: {
      polyfills: [
        'Array.prototype.includes',
        'Promise',
        'fetch',
        'URL',
        'URLSearchParams'
      ]
    }
  },
  {
    // Browser-compat checks apply to shipped library code (src), not tests,
    // which run in Node + Vitest's Chromium.
    files: ['tests/**/*.ts'],
    rules: { 'compat/compat': 'off' }
  }
];
