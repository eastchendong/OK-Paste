import {defineConfig} from 'vitest/config';

// Local exports and integration logs are not another copy of the test suite.
export default defineConfig({test:{include:['tests/**/*.test.{ts,tsx}']}});
