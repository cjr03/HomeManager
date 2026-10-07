import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '@/lib/api'
import { USER, mockApi, renderAt } from '@/test-utils'

vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const DINNER = {
  date: '2026-10-06',
  slot: 'dinner',
  name: 'Spaghetti bolognese',
  servings: 2,
  ingredients: [
    { name: 'Spaghetti', quantity: 250, unit: 'g' },
    { name: 'Onion', quantity: 1, unit: '' },
  ],
  instructions: ['Soften the onion.', 'Simmer the sauce.'],
}
const BREAKFAST = { date: '2026-10-06', slot: 'breakfast', name: 'Porridge', servings: null, ingredients: null, instructions: null }
const PANTRY = { items: [{ name: 'Milk', quantity: 1, unit: 'l' }] }

function setup(extra: Record<string, unknown> = {}) {
  mockApi({
    'GET /api/me': { ...USER, preferences: { ...USER.preferences, diet: 'vegetarian', favorite_cuisines: ['Thai'] } },
    'GET /api/meals?month=2026-10': [DINNER, BREAKFAST],
    'GET /api/pantry': PANTRY,
    'GET /api/meals/shopping-list?week_start=2026-10-04': null,
    'GET /api/meals/shopping-list?week_start=2026-10-18': null,
    ...extra,
  })
  renderAt('/meals')
}

const openDay = async (name = 'Tuesday, October 6') => userEvent.click(await screen.findByRole('button', { name }))

describe('MealsPage', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset()
    vi.mocked(toast.error).mockReset()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 6, 12))
  })
  afterEach(() => vi.useRealTimers())

  it('shows the month with meals in their day cells and today highlighted', async () => {
    setup()
    const day = await screen.findByRole('button', { name: 'Tuesday, October 6' })
    expect(await within(day).findByText('Spaghetti bolognese')).toBeInTheDocument()
    expect(within(day).getByText('Porridge')).toBeInTheDocument()
    expect(day).toHaveAttribute('aria-current', 'date')
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
  })

  it('selects the current week and lets you pick another', async () => {
    setup()
    expect(await screen.findByRole('heading', { name: 'Oct 4 – 10' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Select week of Oct 18' }))
    expect(screen.getByRole('heading', { name: 'Oct 18 – 24' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select week of Oct 18' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('selects the week of a clicked day', async () => {
    setup()
    await openDay('Tuesday, October 20')
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('heading', { name: 'Oct 18 – 24' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select week of Oct 18' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('summarises the household with a link to edit it', async () => {
    setup()
    expect(await screen.findByText('2 people')).toBeInTheDocument()
    expect(screen.getByText('Vegetarian')).toBeInTheDocument()
    expect(screen.getByText('Thai')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Edit household' })).toHaveAttribute('href', '/account')
  })

  describe('day dialog', () => {
    it('shows the recipe of a generated meal', async () => {
      setup()
      await openDay()
      const dialog = await screen.findByRole('dialog', { name: 'Tuesday, October 6' })
      expect(within(dialog).getByLabelText('Dinner')).toHaveValue('Spaghetti bolognese')
      expect(within(dialog).getByText('Serves 2')).toBeInTheDocument()
      expect(within(dialog).getByText('250 g Spaghetti')).toBeInTheDocument()
      expect(within(dialog).getByText('1 Onion')).toBeInTheDocument()
      const steps = within(dialog).getAllByRole('listitem').filter((li) => li.closest('ol'))
      expect(steps.map((li) => li.textContent)).toEqual(['Soften the onion.', 'Simmer the sauce.'])
    })

    it('saves changed slot names and reloads the month', async () => {
      const put = vi.fn((init: { json: unknown }) => ({ date: '2026-10-06', slot: 'lunch', ...(init.json as object) }))
      setup({ 'PUT /api/meals/2026-10-06/lunch': put })
      await openDay()
      const dialog = await screen.findByRole('dialog')
      await userEvent.type(within(dialog).getByLabelText('Lunch'), 'Tomato soup')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
      expect(put).toHaveBeenCalledWith({ method: 'PUT', json: { name: 'Tomato soup' } })
      await vi.waitFor(() =>
        expect(vi.mocked(api).mock.calls.filter(([p]) => p === '/api/meals?month=2026-10')).toHaveLength(2),
      )
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('clears a slot', async () => {
      const del = vi.fn()
      setup({ 'DELETE /api/meals/2026-10-06/dinner': del })
      await openDay()
      await userEvent.click(await screen.findByRole('button', { name: 'Clear dinner' }))
      expect(del).toHaveBeenCalled()
      expect(screen.getByLabelText('Dinner')).toHaveValue('')
    })

    it('deletes a meal whose name was emptied on save', async () => {
      const del = vi.fn()
      setup({ 'DELETE /api/meals/2026-10-06/dinner': del })
      await openDay()
      await userEvent.clear(await screen.findByLabelText('Dinner'))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(del).toHaveBeenCalledWith({ method: 'DELETE' })
      await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })
  })

  describe('pantry', () => {
    it('waits for the saved pantry before allowing edits', async () => {
      setup({ 'GET /api/pantry': () => new Promise(() => {}) })
      expect(await screen.findByText('2 people')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Add item' })).not.toBeInTheDocument()
    })

    it('edits, adds and removes rows, then saves the whole list', async () => {
      const put = vi.fn((init: { json: unknown }) => init.json)
      setup({ 'PUT /api/pantry': put })
      const qty = await screen.findByLabelText('Quantity of Milk')
      await userEvent.clear(qty)
      await userEvent.type(qty, '2')
      await userEvent.click(screen.getByRole('button', { name: 'Add item' }))
      await userEvent.type(screen.getByLabelText('Item 2 name'), 'Eggs')
      await userEvent.type(screen.getByLabelText('Quantity of Eggs'), '6')
      await userEvent.click(screen.getByRole('button', { name: 'Add item' }))
      await userEvent.click(screen.getByRole('button', { name: 'Remove item 3' }))
      await userEvent.click(screen.getByRole('button', { name: 'Remove item 1' }))
      expect(screen.queryByLabelText('Quantity of Milk')).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Save pantry' }))
      expect(put).toHaveBeenCalledWith({
        method: 'PUT',
        json: {
          items: [{ name: 'Eggs', quantity: 6, unit: '' }],
        },
      })
      expect(toast.success).toHaveBeenCalledWith('Pantry saved')
    })

    it('saves unsaved edits, then generates the pantry from the week before the selected one', async () => {
      const put = vi.fn((init: { json: unknown }) => init.json)
      const post = vi.fn(() => ({ items: [{ name: 'Rice', quantity: 0.5, unit: 'kg' }] }))
      setup({ 'PUT /api/pantry': put, 'POST /api/pantry/generate': post })
      const qty = await screen.findByLabelText('Quantity of Milk')
      await userEvent.clear(qty)
      await userEvent.type(qty, '2')
      await userEvent.click(screen.getByRole('button', { name: 'Select week of Oct 18' }))
      const generate = screen.getByRole('button', { name: 'Generate pantry' })
      await userEvent.click(generate)
      expect(put).toHaveBeenCalledWith({ method: 'PUT', json: { items: [{ name: 'Milk', quantity: 2, unit: 'l' }] } })
      expect(post).toHaveBeenCalledWith({ method: 'POST', json: { week_start: '2026-10-11' } })
      expect(await screen.findByLabelText('Quantity of Rice')).toHaveValue(0.5)
      expect(screen.queryByLabelText('Quantity of Milk')).not.toBeInTheDocument()
      expect(toast.success).toHaveBeenCalledWith('Pantry generated from last week')
      expect(generate).toBeDisabled() // once per week, so last week's groceries can't come off twice
    })

    it('keeps the pantry and re-enables Generate when it fails', async () => {
      setup({
        'PUT /api/pantry': (init: { json: unknown }) => init.json,
        'POST /api/pantry/generate': () => {
          throw new ApiError(502, 'The meal assistant is unavailable right now. Please try again.')
        },
      })
      await screen.findByLabelText('Quantity of Milk')
      await userEvent.click(screen.getByRole('button', { name: 'Generate pantry' }))
      await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('The meal assistant is unavailable right now. Please try again.'))
      expect(screen.getByRole('button', { name: 'Generate pantry' })).toBeEnabled()
      expect(screen.getByLabelText('Quantity of Milk')).toHaveValue(1)
    })
  })

  describe('agents', () => {
    it('builds a shopping list grouped by category with check-off and copy', async () => {
      const post = vi.fn(() => ({
        needed: { items: [{ name: 'Spaghetti', quantity: 500, unit: 'g' }] },
        shopping: {
          items: [
            { name: 'Spaghetti', quantity: 500, unit: 'g', category: 'pantry' },
            { name: 'Onion', quantity: 2, unit: '', category: 'produce' },
            { name: 'Garlic', quantity: 1, unit: '', category: 'produce' },
          ],
        },
      }))
      setup({ 'POST /api/meals/shopping-list': post })
      const writeText = vi.fn()
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
      await userEvent.click(await screen.findByRole('button', { name: 'Build shopping list' }))
      expect(post).toHaveBeenCalledWith({ method: 'POST', json: { week_start: '2026-10-04' } })

      const card = await screen.findByRole('region', { name: 'Shopping list' })
      const produce = within(card).getByRole('group', { name: 'Produce' })
      expect(within(produce).getAllByRole('checkbox').map((c) => c.closest('label')!.textContent)).toEqual([
        '2 Onion',
        '1 Garlic',
      ])
      const onion = within(card).getByRole('checkbox', { name: '2 Onion' })
      await userEvent.click(onion)
      expect(onion).toBeChecked()

      await userEvent.click(within(card).getByRole('button', { name: 'Copy' }))
      expect(writeText).toHaveBeenCalledWith('Produce\n- 2 Onion\n- 1 Garlic\n\nPantry\n- 500 g Spaghetti')
      expect(screen.getByRole('region', { name: 'Groceries needed' })).toHaveTextContent('500 g Spaghetti')
    })

    it('resets check-offs when the list is rebuilt and hides results for another week', async () => {
      let items = [
        { name: 'Onion', quantity: 2, unit: '', category: 'produce' },
        { name: 'Garlic', quantity: 1, unit: '', category: 'produce' },
      ]
      setup({ 'POST /api/meals/shopping-list': () => ({ needed: { items: [] }, shopping: { items } }) })
      const build = await screen.findByRole('button', { name: 'Build shopping list' })
      await userEvent.click(build)
      await userEvent.click(await screen.findByRole('checkbox', { name: '2 Onion' }))
      items = [items[1], items[0]]
      await userEvent.click(build)
      await vi.waitFor(() => expect(screen.getAllByRole('checkbox')[0]).toHaveAccessibleName('1 Garlic'))
      expect(screen.getByRole('checkbox', { name: '1 Garlic' })).not.toBeChecked()
      expect(screen.getByRole('checkbox', { name: '2 Onion' })).not.toBeChecked()

      await userEvent.click(screen.getByRole('button', { name: 'Select week of Oct 18' }))
      expect(screen.queryByRole('region', { name: 'Shopping list' })).not.toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Groceries needed' })).not.toBeInTheDocument()
    })

    it("shows each week's saved shopping list", async () => {
      const list = (name: string) => ({ needed: { items: [] }, shopping: { items: [{ name, quantity: 1, unit: '', category: 'produce' }] } })
      setup({
        'GET /api/meals/shopping-list?week_start=2026-10-04': list('Onion'),
        'GET /api/meals/shopping-list?week_start=2026-10-18': list('Leek'),
      })
      const card = await screen.findByRole('region', { name: 'Shopping list' })
      expect(within(card).getByRole('checkbox', { name: '1 Onion' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Select week of Oct 18' }))
      expect(await screen.findByRole('checkbox', { name: '1 Leek' })).toBeInTheDocument()
      expect(screen.queryByRole('checkbox', { name: '1 Onion' })).not.toBeInTheDocument()
    })

    it('offers only the shopping list, not a separate groceries-needed button', async () => {
      setup({})
      await screen.findByRole('button', { name: 'Build shopping list' })
      expect(screen.queryByRole('button', { name: 'Groceries needed' })).not.toBeInTheDocument()
    })

    it('generates meals for chosen slots and reloads the month', async () => {
      const post = vi.fn(() => [DINNER])
      setup({ 'POST /api/meals/generate': post })
      await userEvent.click(await screen.findByRole('button', { name: 'Generate meals' }))
      const dialog = await screen.findByRole('dialog', { name: 'Generate meals' })
      await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Snack' }))
      await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Replace meals already planned' }))
      await userEvent.click(within(dialog).getByRole('button', { name: 'Generate' }))
      expect(post).toHaveBeenCalledWith({
        method: 'POST',
        json: { week_start: '2026-10-04', slots: ['breakfast', 'lunch', 'dinner'], overwrite: true },
      })
      expect(toast.success).toHaveBeenCalledWith('Added 1 meal')
    })

    it('shows the server error in a toast', async () => {
      setup({
        'POST /api/meals/shopping-list': () => {
          throw new ApiError(502, 'The meal assistant is unavailable right now. Please try again.')
        },
      })
      await userEvent.click(await screen.findByRole('button', { name: 'Build shopping list' }))
      await vi.waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('The meal assistant is unavailable right now. Please try again.'),
      )
      expect(screen.getByRole('button', { name: 'Build shopping list' })).toBeEnabled()
    })
  })

  describe('assistant', () => {
    const list = (...names: string[]) => ({
      needed: { items: [] },
      shopping: { items: names.map((name) => ({ name, quantity: 1, unit: '', category: 'produce' })) },
    })
    const calls = (path: string) => vi.mocked(api).mock.calls.filter(([p, init]) => p === path && !init?.method).length
    const SHOP = '/api/meals/shopping-list?week_start=2026-10-04'

    async function setupAssistant(after: { meals?: unknown[]; shopping?: unknown; pantry?: unknown }) {
      let changed = false
      setup({
        'GET /api/meals?month=2026-10': () => (changed && after.meals) || [DINNER, BREAKFAST],
        [`GET ${SHOP}`]: () => (changed && after.shopping) || list('Onion', 'Garlic'),
        'GET /api/pantry': () => (changed && after.pantry) || PANTRY,
        'POST /api/assistant': (init: { json: { context: unknown } }) => {
          changed = true
          expect(init.json.context).toEqual({ week_start: '2026-10-04' })
          return { reply: 'Done.', changed: true }
        },
      })
      const card = await screen.findByRole('region', { name: 'Shopping list' })
      await userEvent.click(within(card).getByLabelText('1 Onion'))
      const qty = await screen.findByLabelText('Quantity of Milk')
      await userEvent.clear(qty)
      await userEvent.type(qty, '3')
      await userEvent.type(screen.getByRole('textbox', { name: 'Message the assistant' }), 'Do it{Enter}')
      await screen.findByText('Done.')
      await waitFor(() => expect(calls(SHOP)).toBe(2))
      await waitFor(() => expect(calls('/api/pantry')).toBe(2))
    }

    it('refetches meals and the shopping list, keeping check-offs and unsaved pantry edits when they did not change', async () => {
      await setupAssistant({ meals: [{ ...DINNER, name: 'Pad thai' }] })
      expect(await screen.findByText('Pad thai')).toBeInTheDocument()
      expect(within(screen.getByRole('region', { name: 'Shopping list' })).getByLabelText('1 Onion')).toBeChecked()
      expect(screen.getByLabelText('Quantity of Milk')).toHaveValue(3)
    })

    it('shows a changed shopping list and pantry', async () => {
      await setupAssistant({ shopping: list('Leek'), pantry: { items: [{ name: 'Eggs', quantity: 6, unit: '' }] } })
      const card = screen.getByRole('region', { name: 'Shopping list' })
      expect(await within(card).findByLabelText('1 Leek')).not.toBeChecked()
      expect(await screen.findByLabelText('Quantity of Eggs')).toHaveValue(6)
    })
  })
})
