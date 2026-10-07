import { defineConfig, devices } from '@playwright/test'

const reuseExistingServer = !process.env.CI
// Override per worktree so parallel branches never share (or reuse) each other's servers.
const apiPort = process.env.API_PORT ?? '8000'
const webPort = process.env.WEB_PORT ?? '5173'

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${webPort}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `../backend/.venv/bin/uvicorn app.main:app --port ${apiPort}`,
      cwd: '../backend',
      url: `http://localhost:${apiPort}/api/health`,
      env: {
        DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgresql+psycopg:///homemanager_e2e',
        LLM_FAKE: '1',
        JWT_SECRET: 'e2e-secret-at-least-32-bytes-long!!',
      },
      reuseExistingServer,
    },
    {
      command: `npm run dev -- --port ${webPort} --strictPort`,
      url: `http://localhost:${webPort}`,
      env: { API_PORT: apiPort },
      reuseExistingServer,
    },
  ],
})
