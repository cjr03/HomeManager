import { defineConfig, devices } from '@playwright/test'

const reuseExistingServer = !process.env.CI

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: '../backend/.venv/bin/uvicorn app.main:app --port 8000',
      cwd: '../backend',
      url: 'http://localhost:8000/api/health',
      env: {
        DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgresql+psycopg:///homemanager_e2e',
        LLM_FAKE: '1',
        JWT_SECRET: 'e2e-secret',
      },
      reuseExistingServer,
    },
    { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer },
  ],
})
