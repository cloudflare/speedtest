import js from '@eslint/js';
import compat from 'eslint-plugin-compat';
import importPlugin from 'eslint-plugin-import';
import json from 'eslint-plugin-json';
import prettier from 'eslint-plugin-prettier';

export default [
  // Base configuration
  js.configs.recommended,
  compat.configs['flat/recommended'],
  importPlugin.flatConfigs.recommended,
  json.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
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

      'import/first': 'warn',
      'import/no-absolute-path': 'error',
      'import/no-deprecated': 'warn',
      'import/no-mutable-exports': 'warn',

      'prettier/prettier': 'error'
    },
    settings: {
      // Polyfills for compat plugin
      polyfills: [
        'Array.prototype.includes',
        'Promise',
        'fetch',
        'URL',
        'URLSearchParams'
      ]
    }
  }
];
