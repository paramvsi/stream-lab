import { defineConfig } from '@playwright/test';

const PORT = 5290; // apps/desktop's dev port (--strictPort)

/** The desktop app's React screens in a browser (the Tauri shell is not built yet: TESTING.md's WebDriver run comes with it). */
export default defineConfig({
  testDir: 'apps/desktop/e2e',
  outputDir: 'test-results-desktop',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, channel: 'chrome', trace: 'retain-on-failure' },
  // CLAUDE.md: check every screen at 1440×900 and 1280×800.
  projects: [
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'desktop-1280', use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: 'pnpm --filter @sl/desktop dev',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
