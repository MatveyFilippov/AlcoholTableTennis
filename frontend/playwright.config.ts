import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: process.env.ATT_E2E_URL ?? 'http://127.0.0.1:8080', trace: 'retain-on-failure',
    contextOptions: { reducedMotion: 'reduce' } },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
    { name: 'narrow', use: { ...devices['iPhone SE'], defaultBrowserType: 'chromium',
      viewport: { width: 320, height: 700 } } },
  ],
})
