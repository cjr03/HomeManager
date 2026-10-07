import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  // page.request shares the browser context's cookies, so this signs the page in.
  const username = `smoke${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 1e3)}`
  const res = await page.request.post('/api/auth/signup', {
    data: { email: `${username}@example.com`, username, password: 'Smoke-pass1', password_confirm: 'Smoke-pass1' },
  })
  expect(res.status()).toBe(201)
})

test('app loads with the brand and reaches the API through the proxy', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.getByText('HomeManager').first()).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'Meals' })).toBeVisible()

  const health = await request.get('/api/health')
  expect(await health.json()).toEqual({ status: 'ok' })
})

test('nav moves between monthly pages', async ({ page }) => {
  await page.goto('/meals')
  await page.getByRole('link', { name: 'Calendar' }).click()
  await expect(page).toHaveURL(/\/calendar$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Calendar' })).toBeVisible()
})
