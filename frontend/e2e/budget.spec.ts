import { expect, test, type Browser, type Page } from '@playwright/test'
import { currentMonth } from '../src/lib/month.ts'

const unique = (p: string) => `${p}${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 1e3)}`
const MONTH = currentMonth()

// The signup UI is covered by auth.spec.ts; here we sign up through the API to get straight to the budget.
async function newUser(browser: Browser, username = unique('bud')) {
  const page = await (await browser.newContext()).newPage()
  const password = 'Budget-pass1'
  const res = await page.request.post('/api/auth/signup', {
    data: { email: `${username}@example.com`, username, password, password_confirm: password },
  })
  expect(res.status()).toBe(201)
  return { page, username }
}

async function addLine(page: Page, kind: string, values: Record<string, string>) {
  await page.getByRole('button', { name: `Add ${kind}` }).click()
  for (const [label, value] of Object.entries(values)) await page.getByLabel(label, { exact: true }).fill(value)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('listitem', { name: values.Name })).toBeVisible()
}

test('budget a month, watch the overview update, then copy it into next month', async ({ browser }) => {
  const { page } = await newUser(browser)
  await page.goto('/budget')
  const overview = page.getByRole('region', { name: 'Overview' })
  await expect(overview).toContainText('$0.00')
  await expect(page.getByRole('button', { name: 'Copy last month' })).toBeVisible()

  await addLine(page, 'income', { Name: 'Salary', 'Pre-tax': '5000', 'Post-tax': '3800' })
  await addLine(page, 'expense', { Name: 'Rent', Budgeted: '1500', Actual: '1400' })
  await addLine(page, 'savings', { Name: 'Holiday', Budgeted: '300', Actual: '300' })
  const netWorth = overview.getByRole('group', { name: 'Net worth' })
  await addLine(page, 'asset', { Name: 'Car', Value: '9000' })
  await expect(netWorth).toContainText('$9,000.00')
  await addLine(page, 'loan', { Name: 'Mortgage', 'Amount owed': '4000' })

  // remainder: 3800 - 1500 - 300 = 2000 budgeted, 3800 - 1400 - 300 = 2100 actual
  await expect(overview).toContainText('$2,000.00')
  await expect(overview).toContainText('$2,100.00')
  await expect(overview).toContainText('+$100.00')
  // net worth = 9000 owned - 4000 owed; no other figure in the tile is 5000
  await expect(netWorth.getByText('$5,000.00', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Edit Rent' }).click()
  await page.getByLabel('Actual').fill('1600')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(overview).toContainText('$1,900.00')
  await expect(overview).toContainText('-$100.00')

  await page.getByRole('button', { name: 'Next month' }).click()
  await page.getByRole('button', { name: 'Copy last month' }).click()
  await expect(page.getByRole('listitem', { name: 'Rent' })).toBeVisible()
  await expect(page.getByRole('listitem', { name: 'Salary' })).toBeVisible()
  await expect(overview).toContainText('$2,000.00')
  await expect(page.getByRole('button', { name: 'Copy last month' })).toBeHidden()

  await page.getByRole('button', { name: 'Delete Car' }).click()
  await expect(page.getByRole('listitem', { name: 'Car' })).toBeHidden()
})

test('linked users share a budget, split each line, and see their share at home', async ({ browser }) => {
  const a = await newUser(browser, unique('ann'))
  const b = await newUser(browser, unique('ben'))
  expect((await a.page.request.post('/api/links', { data: { username: b.username } })).status()).toBe(201)
  const { incoming } = await (await b.page.request.get('/api/links')).json()
  expect((await b.page.request.post(`/api/links/${incoming[0].id}/accept`)).ok()).toBe(true)

  for (const [user, name, post] of [[a, 'Ann pay', '3000'], [b, 'Ben pay', '1500']] as const) {
    const res = await user.page.request.post(`/api/budget/${MONTH}/lines`, {
      data: { kind: 'income', name, a: '4000', b: post },
    })
    expect(res.status()).toBe(201)
  }

  await a.page.goto('/budget')
  await expect(a.page.getByRole('listitem', { name: 'Ann pay' })).toBeVisible()
  await expect(a.page.getByRole('listitem', { name: 'Ben pay' })).toBeHidden()

  await a.page.getByRole('tab', { name: `Shared with ${b.username}` }).click()
  await expect(a.page.getByText('Who brings what')).toBeHidden()
  await expect(a.page.getByText(`Nothing shared for`)).toBeVisible()
  await expect(a.page.getByRole('listitem', { name: 'Ann pay' })).toBeHidden()
  await expect(a.page.getByRole('listitem', { name: 'Ben pay' })).toBeHidden()

  await a.page.getByRole('button', { name: 'Add expense' }).click()
  await a.page.getByLabel('Name').fill('Rent')
  await a.page.getByLabel('Budgeted').fill('2000')
  await a.page.getByLabel('Your share %').fill('25')
  await a.page.getByLabel(`${b.username}'s share %`).fill('75')
  await a.page.getByRole('button', { name: 'Save' }).click()
  await expect(a.page.getByRole('listitem', { name: 'Rent' })).toContainText('25/75 split')
  await expect(a.page.getByRole('button', { name: 'Edit Rent' })).toBeVisible()
  await expect(a.page.getByRole('region', { name: 'Overview' })).toContainText('$2,000.00')

  await b.page.goto('/budget')
  const rent = b.page.getByRole('listitem', { name: 'Rent' })
  await expect(rent).toContainText('Shared')
  await expect(rent).toContainText('$1,500.00')
  await expect(b.page.getByRole('button', { name: 'Edit Rent' })).toBeHidden()
})
