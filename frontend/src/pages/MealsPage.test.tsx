import { screen, within } from '@testing-library/react'
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
    expect(within(day).getByText('Spaghetti bolognese')).toBeInTheDocument()
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
  })

  describe('pantry', () => {
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
      await userEvent.click(screen.getByRole('button', { name: 'Save pantry' }))
      expect(put).toHaveBeenCalledWith({
        method: 'PUT',
        json: {
          items: [
            { name: 'Milk', quantity: 2, unit: 'l' },
            { name: 'Eggs', quantity: 6, unit: '' },
          ],
        },
      })
      expect(toast.success).toHaveBeenCalledWith('Pantry saved')
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
      expect(writeText).toHaveBeenCalledWith('Pantry\n- 500 g Spaghetti\n\nProduce\n- 2 Onion\n- 1 Garlic')
      expect(screen.getByRole('region', { name: 'Groceries needed' })).toHaveTextContent('500 g Spaghetti')
    })

    it('shows the groceries needed for the week', async () => {
      setup({ 'POST /api/meals/groceries-needed': { items: [{ name: 'Rice', quantity: 0.75, unit: 'kg' }] } })
      await userEvent.click(await screen.findByRole('button', { name: 'Groceries needed' }))
      expect(await screen.findByRole('region', { name: 'Groceries needed' })).toHaveTextContent('0.75 kg Rice')
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
        'POST /api/meals/groceries-needed': () => {
          throw new ApiError(502, 'The meal assistant is unavailable right now. Please try again.')
        },
      })
      await userEvent.click(await screen.findByRole('button', { name: 'Groceries needed' }))
      await vi.waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('The meal assistant is unavailable right now. Please try again.'),
      )
      expect(screen.getByRole('button', { name: 'Groceries needed' })).toBeEnabled()
    })
  })
})
