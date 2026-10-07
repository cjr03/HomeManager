import { expect, test } from '@playwright/test'

// LLM_FAKE=1: "add X to the pantry" makes the fake assistant call add_pantry_items for X (quantity 1, no unit).
test('Mikayla adds an item to the pantry from the meals page', async ({ page }) => {
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

  const assistant = page.getByRole('complementary', { name: 'Mikayla' })
  await assistant.getByLabel('Message Mikayla').fill('add 3 lemons to the pantry')
  await assistant.getByLabel('Message Mikayla').press('Enter')
  await expect(assistant.getByText('Added 3 lemons to the pantry.')).toBeVisible()

  const pantry = page.getByRole('region', { name: 'Pantry' })
  await expect(pantry.getByLabel('Item 1 name')).toHaveValue('3 lemons')
})

// The browser's recognizer is swapped for one that "hears" a fixed sentence; speechSynthesis is spied on.
test('talking to Mikayla sends what was heard and reads the reply out as printed', async ({ page }) => {
  await page.addInitScript(() => {
    // No DOM lib in the e2e tsconfig, so type just what is touched.
    const w = globalThis as unknown as Record<string, unknown> & { said: string[]; speechSynthesis: { speak(u: { text: string }): void } }
    w.said = []
    w.SpeechRecognition = w.webkitSpeechRecognition = class {
      onresult?: (e: unknown) => void
      onend?: () => void
      start() {
        setTimeout(() => {
          this.onresult?.({ results: [Object.assign([{ transcript: 'add 2 limes to the pantry' }], { isFinal: true })] })
          setTimeout(() => this.onend?.(), 50)
        }, 50)
      }
      stop() {}
      abort() {}
    }
    w.speechSynthesis.speak = (u) => void w.said.push(u.text)
  })
  const username = `voice${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 1e3)}`
  const res = await page.request.post('/api/auth/signup', {
    data: { email: `${username}@example.com`, username, password: 'Assist-pass1', password_confirm: 'Assist-pass1', household_size: 2 },
  })
  expect(res.status()).toBe(201)
  await page.goto('/meals')

  const assistant = page.getByRole('complementary', { name: 'Mikayla' })
  await assistant.getByRole('button', { name: 'Talk to Mikayla' }).click()
  await expect(assistant.getByText('Added 2 limes to the pantry.')).toBeVisible()
  await expect(assistant.getByText('add 2 limes to the pantry', { exact: true })).toBeVisible()
  const said = await page.evaluate(() => (globalThis as unknown as { said: string[] }).said.filter(Boolean).join(' '))
  expect(said).toBe('Added 2 limes to the pantry.')
})
