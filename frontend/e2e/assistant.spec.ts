import { expect, test } from '@playwright/test'

// LLM_FAKE=1: "add X to the pantry" makes the fake assistant call add_pantry_items for X (quantity 1, no unit).
test('the assistant adds an item to the pantry from the meals page', async ({ page }) => {
  const username = `asst${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 1e3)}`
  const res = await page.request.post('/api/auth/signup', {
    data: {
      email: `${username}@example.com`,
      username,
      password: 'Assist-pass1',
      password_confirm: 'Assist-pass1',
      household_size: 2,
    },
  })
  expect(res.status()).toBe(201)
  await page.goto('/meals')

  const assistant = page.getByRole('complementary', { name: 'Assistant' })
  await assistant.getByLabel('Message the assistant').fill('add 3 lemons to the pantry')
  await assistant.getByLabel('Message the assistant').press('Enter')
  await expect(assistant.getByText('Added 3 lemons to the pantry.')).toBeVisible()

  const pantry = page.getByRole('region', { name: 'Pantry' })
  await expect(pantry.getByLabel('Item 1 name')).toHaveValue('3 lemons')
})
