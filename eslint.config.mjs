import { fixupConfigRules } from '@eslint/compat';
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import prettier from 'eslint-plugin-prettier';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default defineConfig([
  {
    extends: fixupConfigRules(compat.extends('@react-native', 'prettier')),
    plugins: { prettier },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'prettier/prettier': 'error',
    },
  },
  {
    // The example's screens use theme-dependent colors (light/dark), applied inline.
    files: ['example/**/*.{js,ts,tsx}'],
    rules: {
      'react-native/no-inline-styles': 'off',
    },
  },
  {
    // Repository tooling: ES modules run by Node.
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    ignores: [
      'node_modules/',
      'lib/',
      'coverage/',
      '**/build/',
      'example/vendor/',
      // The Expo example's native projects are made by `expo prebuild` and not kept.
      'example-expo/ios/',
      'example-expo/android/',
      'example-expo/.expo/',
      // The docs site is a project of its own, with its own lint.
      'docs/',
    ],
  },
]);
