import { expect, test } from '@playwright/test'

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
