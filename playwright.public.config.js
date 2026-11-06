import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/public-browser',
  workers: 1,
  forbidOnly: !!process.env.CI,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:4191',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'npm run build && npm exec vite preview -- --host 127.0.0.1 --port 4191 --strictPort',
    url: 'http://127.0.0.1:4191',
    env: { VITE_STATIC_SITE: 'true' },
    timeout: 120000,
    reuseExistingServer: false,
  },
});
