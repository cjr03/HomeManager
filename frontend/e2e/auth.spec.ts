import { expect, test, type Page } from '@playwright/test'

const unique = (p: string) => `${p}${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 1e3)}`

async function signUp(page: Page, username: string, password = 'First-pass1') {
  await page.goto('/login')
  await page.getByRole('tab', { name: 'Sign up' }).click()
  await page.getByLabel('Email').fill(`${username}@example.com`)
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password').fill(password)
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'More people' }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Vegetarian' }).click()
  await page.getByRole('button', { name: 'Thai' }).click()
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Meals' })).toBeVisible()
}

async function logIn(page: Page, username: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
}

async function logOut(page: Page) {
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /welcome/i })).toBeVisible()
}

test('sign up through every phase, then log out and back in', async ({ page }) => {
  const username = unique('ann')
  await signUp(page, username)
  await expect(page.getByLabel(`Signed in as ${username}`)).toBeVisible()

  await page.getByRole('link', { name: 'Account' }).click()
  await expect(page.getByText(`${username}@example.com`)).toBeVisible()
  await expect(page.getByLabel('People in your household')).toHaveValue('2')
  await expect(page.getByRole('button', { name: 'Vegetarian' })).toHaveAttribute('aria-pressed', 'true')

  await logOut(page)
  await page.goto('/meals')
  await expect(page).toHaveURL(/\/login$/)

  await logIn(page, username, 'First-pass1')
  await expect(page.getByRole('heading', { level: 1, name: 'Meals' })).toBeVisible()
})

test('wrong password shows an error', async ({ page }) => {
  const username = unique('bob')
  await signUp(page, username)
  await logOut(page)
  await logIn(page, username, 'not-the-password')
  await expect(page.getByRole('alert')).toHaveText('Invalid username or password')
  await expect(page).toHaveURL(/\/login$/)
})

test('change password, then log in with the new one', async ({ page }) => {
  const username = unique('cat')
  await signUp(page, username)
  await page.goto('/account')
  await page.getByRole('button', { name: 'Change password' }).click()
  await page.getByLabel('Current password').fill('First-pass1')
  await page.getByLabel('New password', { exact: true }).fill('Second-pass1')
  await page.getByLabel('Confirm new password').fill('Second-pass1')
  await page.getByRole('button', { name: 'Update password' }).click()
  await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible()

  await logOut(page)
  await logIn(page, username, 'First-pass1')
  await expect(page.getByRole('alert')).toBeVisible()
  await logIn(page, username, 'Second-pass1')
  await expect(page.getByRole('heading', { level: 1, name: 'Meals' })).toBeVisible()
})

test('two users link accounts', async ({ browser }) => {
  const [a, b] = [unique('dan'), unique('eve')]
  const pa = await (await browser.newContext()).newPage()
  const pb = await (await browser.newContext()).newPage()
  await signUp(pa, a)
  await signUp(pb, b)

  await pa.goto('/account')
  await pa.getByLabel('Username to link').fill(b)
  await pa.getByRole('button', { name: 'Send request' }).click()
  await expect(pa.getByRole('button', { name: `Cancel request to ${b}` })).toBeVisible()

  await pb.goto('/account')
  await pb.getByRole('button', { name: `Accept ${a}` }).click()
  await expect(pb.getByRole('button', { name: `Unlink ${a}` })).toBeVisible()

  await pa.reload()
  await expect(pa.getByRole('button', { name: `Unlink ${b}` })).toBeVisible()
})
