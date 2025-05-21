import js from '@eslint/js';
import compat from 'eslint-plugin-compat';
import importPlugin from 'eslint-plugin-import';
import json from 'eslint-plugin-json';
import prettier from 'eslint-plugin-prettier';
import babelEslintParser from '@babel/eslint-parser';

export default [
  // Base configuration
  js.configs.recommended,
  compat.configs['flat/recommended'],
  importPlugin.flatConfigs.recommended,
  json.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022, // Matches es2022 from env and ecmaVersion 13
      sourceType: 'module',
      parser: babelEslintParser
    },
    plugins: {
      json: json,
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
      polyfills: ['Array.prototype.includes', 'Promise', 'fetch'] // Adjust based on your needs
    }
  }
];
