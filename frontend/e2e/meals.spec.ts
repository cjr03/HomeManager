import { expect, test } from '@playwright/test'

// The backend runs with LLM_FAKE=1, so the agents return deterministic canned meals and lists.
test('plan a week: pantry, generate, edit a meal, build the shopping list, generate next pantry', async ({ page }) => {
  const username = `meals${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 1e3)}`
  const res = await page.request.post('/api/auth/signup', {
    data: {
      email: `${username}@example.com`,
      username,
      password: 'Meals-pass1',
      password_confirm: 'Meals-pass1',
      household_size: 2,
    },
  })
  expect(res.status()).toBe(201)
  await page.goto('/meals')

  // Pantry: 3 l milk covers the fake week's milk need (1 l per person).
  const pantry = page.getByRole('region', { name: 'Pantry' })
  await pantry.getByRole('button', { name: 'Add item' }).click()
  await pantry.getByLabel('Item 1 name').fill('Milk')
  await pantry.getByLabel('Quantity of Milk').fill('3')
  await pantry.getByLabel('Unit of Milk').fill('l')
  await pantry.getByRole('button', { name: 'Save pantry' }).click()
  await expect(page.getByText('Pantry saved')).toBeVisible()

  // Next month's second row is always a full week inside that month.
  await page.getByRole('button', { name: 'Next month' }).click()
  const weeks = page.getByRole('button', { name: /^Select week of / })
  await weeks.nth(1).click()

  await page.getByRole('button', { name: 'Generate meals' }).click()
  const generate = page.getByRole('dialog', { name: 'Generate meals' })
  await generate.getByRole('button', { name: 'Generate' }).click()
  await expect(generate).toBeHidden()
  const grid = page.getByRole('region', { name: 'Month' })
  const bolognese = grid.getByRole('button').filter({ hasText: 'Spaghetti bolognese' }).first()
  await expect(bolognese).toBeVisible()
  await expect(grid.getByText('Banana porridge').first()).toBeVisible()

  // Open the day: recipe details, then rename dinner.
  await bolognese.click()
  const day = page.getByRole('dialog')
  await day.getByText('Dinner recipe').click()
  await expect(day.getByText('Dice the onion and soften it in olive oil for 5 minutes.')).toBeVisible()
  await day.getByLabel('Dinner', { exact: true }).fill('Family lasagne')
  await day.getByRole('button', { name: 'Save' }).click()
  await expect(day).toBeHidden()
  await expect(grid.getByText('Family lasagne')).toBeVisible()

  await page.getByRole('button', { name: 'Build shopping list' }).click()
  const list = page.getByRole('region', { name: 'Shopping list' })
  await expect(list.getByRole('group', { name: 'Produce' })).toContainText('Onion')
  await expect(list.getByRole('group', { name: 'Meat' })).toContainText('Ground beef')
  await expect(list).not.toContainText('Milk')
  await list.getByRole('checkbox', { name: /Onion/ }).check()
  await expect(list.getByRole('checkbox', { name: /Onion/ })).toBeChecked()
  await expect(page.getByRole('region', { name: 'Groceries needed' })).toContainText('2 l Milk')

  // The following week: last week's pantry + shopping - groceries needed leaves 1 l milk.
  await weeks.nth(2).click()
  await pantry.getByRole('button', { name: 'Generate pantry' }).click()
  await expect(page.getByText('Pantry generated from last week')).toBeVisible()
  await expect(pantry.getByLabel('Quantity of Milk')).toHaveValue('1')
  await expect(pantry.getByLabel('Item 2 name')).toHaveCount(0)
})
