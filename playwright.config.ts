import { defineConfig } from '@playwright/test';

const PORT = 5280; // 5173 is often taken by other local projects

export default defineConfig({
  testDir: 'apps/web/e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // ponytail: the installed Google Chrome, so no browser download. CI installs it with `npx playwright install chrome`.
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  // CLAUDE.md: check every screen at 1440×900 and 1280×800.
  projects: [
    { name: '1440', use: { viewport: { width: 1440, height: 900 } } },
    { name: '1280', use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `pnpm --filter @sl/web exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
