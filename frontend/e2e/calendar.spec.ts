import { expect, test, type Page } from '@playwright/test'

const unique = (p: string) => `${p}${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 1e3)}`

/** Signs the page's browser context in as a fresh user (page.request shares its cookies). */
async function signUp(page: Page) {
  const username = unique('cal')
  const res = await page.request.post('/api/auth/signup', {
    data: { email: `${username}@example.com`, username, password: 'Calendar-pass1', password_confirm: 'Calendar-pass1' },
  })
  expect(res.status()).toBe(201)
  return username
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const cellName = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
const cell = (page: Page, d: Date) => page.getByRole('button', { name: cellName(d), exact: true })

test('create an event and see it on the grid', async ({ page }) => {
  await signUp(page)
  await page.goto('/calendar')
  const today = page.locator('[aria-current="date"]')
  await today.click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Add event' }).click()
  await dialog.getByLabel('Title').fill('Dentist')
  await dialog.getByLabel('Time').fill('09:30')
  await dialog.getByRole('button', { name: 'Save event' }).click()
  await expect(dialog.getByText('Dentist')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(today.getByText('Dentist')).toBeVisible()
  await expect(today.getByText('09:30')).toBeVisible()
})

test('a weekly chore starting today shows on the right days', async ({ page }) => {
  await signUp(page)
  await page.goto('/calendar')
  await page.getByRole('button', { name: 'New chore' }).click()
  await page.getByLabel('Title').fill('Water plants')
  await page.getByLabel('Repeats').selectOption({ label: 'Every week' })
  await page.getByRole('button', { name: 'Save chore' }).click()
  await expect(page.getByText('Every week from')).toBeVisible()

  // Check the six days in between in whichever month shows them, each after that month's chores loaded.
  const now = new Date()
  const [, ...between] = Array.from({ length: 7 }, (_, i) => addDays(now, i))
  const nextWeek = addDays(now, 7)
  const thisMonth = (d: Date) => d.getMonth() === now.getMonth()
  const absent = async (days: Date[]) => {
    for (const d of days) await expect(cell(page, d).getByText('Water plants')).toHaveCount(0)
  }
  await expect(cell(page, now).getByText('Water plants')).toBeVisible()
  await absent(between.filter(thisMonth))
  if (!thisMonth(nextWeek)) await page.getByRole('button', { name: 'Next month' }).click()
  await expect(cell(page, nextWeek).getByText('Water plants')).toBeVisible()
  await absent(between.filter((d) => !thisMonth(d)))
})

test('assign a chore to a linked partner who marks it done from the account page', async ({ browser }) => {
  const pa = await (await browser.newContext()).newPage()
  const pb = await (await browser.newContext()).newPage()
  await signUp(pa)
  const partner = await signUp(pb)
  const link = await (await pa.request.post('/api/links', { data: { username: partner } })).json()
  expect((await pb.request.post(`/api/links/${link.id}/accept`)).ok()).toBe(true)

  await pa.goto('/calendar')
  await pa.getByRole('button', { name: 'New chore' }).click()
  await pa.getByLabel('Title').fill('Take out bins')
  await pa.getByLabel('Assignee').selectOption({ label: partner })
  await pa.getByRole('button', { name: 'Save chore' }).click()
  await expect(pa.getByText('Once on')).toBeVisible()

  await pb.goto('/account')
  const card = pb.locator('[data-slot="card"]', { has: pb.getByRole('heading', { name: "Today's chores" }) })
  const box = card.getByRole('checkbox', { name: 'Take out bins' })
  await expect(box).not.toBeChecked()
  await box.check()
  await expect(box).toBeChecked()
  await pb.reload()
  await expect(box).toBeChecked()

  await pa.reload()
  const today = pa.locator('[aria-current="date"]')
  await expect(today.getByText('Take out bins').locator('xpath=ancestor::li[1]')).toContainText('done')
})
