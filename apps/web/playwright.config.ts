import { defineConfig, devices } from '@playwright/test';

const port = 3100;
/** A second instance with `site.public: false`. */
const privatePort = 3101;

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    // Reuse a system Chromium (e.g. in sandboxes without `playwright install`).
    ...(process.env.PW_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
      : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Serves the production build from the API server, like the container does: one public, one private site.
  webServer: [
    { port, config: 'e2e/status.e2e.yaml' },
    { port: privatePort, config: 'e2e/status.private.e2e.yaml' },
  ].map((s) => ({
    command: 'node ../server/src/index.ts',
    url: `http://127.0.0.1:${s.port}/readyz`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: String(s.port),
      BASE_URL: `http://127.0.0.1:${s.port}`,
      CONFIG_PATH: s.config,
      DATABASE_URL: 'sqlite::memory:',
      PLUGINS_DIR: '../../plugins',
      WEB_DIST: 'dist',
      LOG_LEVEL: 'warn',
    },
  })),
});
