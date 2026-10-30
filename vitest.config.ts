import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node'
        }
      },
      {
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.test.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            // Firefox is left out: on new HTTPS connections close to the server it
            // stamps responseStart before any response bytes arrive, so latency is 0.
            instances: [{ browser: 'chromium' }, { browser: 'webkit' }]
          }
        }
      }
    ]
  }
});
