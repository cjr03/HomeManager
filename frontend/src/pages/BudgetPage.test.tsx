import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '@/lib/api'
import { currentMonth } from '@/lib/month'
import { USER, mockApi, renderAt } from '@/test-utils'

vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: vi.fn() }))

const M = currentMonth()
const zero = { budgeted: '0.00', actual: '0.00', difference: '0.00' }
const zeroRange = { start: '0.00', end: '0.00', difference: '0.00' }
const EMPTY_SUMMARY = {
  assets: '0.00', debit: zeroRange, income: { pre_tax: '0.00', post_tax: '0.00' }, loans: '0.00', credit: zeroRange,
  expenses: zero, savings: zero, remainder: zero, net_worth: '0.00',
}
const SUMMARY = {
  ...EMPTY_SUMMARY,
  assets: '15000.00',
  income: { pre_tax: '5000.00', post_tax: '3800.00' },
  expenses: { budgeted: '1500.00', actual: '1400.00', difference: '100.00' },
  remainder: { budgeted: '2300.00', actual: '2400.00', difference: '100.00' },
  net_worth: '12345.67',
}
const line = (id: number, kind: string, name: string, a: string, b: string | null, owner_id = 1) => ({
  id, owner_id, month: M, kind, name, a, b, position: id,
})
const MINE = {
  lines: [line(1, 'income', 'Salary', '5000.00', '3800.00'), line(2, 'expense', 'Rent', '1500.00', '1400.00')],
  summary: SUMMARY,
}
const NO_LINKS = { incoming: [], outgoing: [], linked: [] }
const BOB = { id: 2, username: 'bob', avatar: null }

function setup(routes: Record<string, unknown>) {
  mockApi({ 'GET /api/me': USER, 'GET /api/links': NO_LINKS, ...routes })
  renderAt('/budget')
}

const overview = async () => within(await screen.findByRole('region', { name: 'Overview' }))

describe('BudgetPage', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset()
  })

  it('renders the overview band from the summary', async () => {
    setup({ [`GET /api/budget/${M}`]: MINE })
    const o = await overview()
    expect(o.getByText('$12,345.67')).toBeInTheDocument()
    expect(o.getByText('$2,300.00')).toBeInTheDocument()
    expect(o.getByText('$2,400.00')).toBeInTheDocument()
    expect(o.getByText('+$100.00').closest('[data-tone]')).toHaveAttribute('data-tone', 'good')
    expect(o.getByText('$5,000.00')).toBeInTheDocument()
    expect(o.getByText('$3,800.00')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Legend' })).getByText('Needs attention')).toBeInTheDocument()
    for (const name of ['What you own', 'What you owe', "This month's plan"])
      expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: 'Rent' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy last month' })).not.toBeInTheDocument()
  })

  it('adds, edits and deletes lines and reloads', async () => {
    setup({
      [`GET /api/budget/${M}`]: MINE,
      [`POST /api/budget/${M}/lines`]: {},
      'PATCH /api/budget/lines/2': {},
      'DELETE /api/budget/lines/2': undefined,
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Add savings' }))
    await userEvent.type(screen.getByLabelText('Name'), 'Holiday')
    await userEvent.type(screen.getByLabelText('Budgeted'), '200')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api).toHaveBeenCalledWith(`/api/budget/${M}/lines`, {
      method: 'POST',
      json: { kind: 'savings', name: 'Holiday', a: '200', b: null },
    })

    await userEvent.click(screen.getByRole('button', { name: 'Edit Rent' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api).toHaveBeenCalledWith('/api/budget/lines/2', {
      method: 'PATCH',
      json: { name: 'Rent', a: '1500.00', b: '1400.00' },
    })

    await userEvent.click(screen.getByRole('button', { name: 'Delete Rent' }))
    expect(api).toHaveBeenCalledWith('/api/budget/lines/2', { method: 'DELETE' })
    expect(vi.mocked(api).mock.calls.filter(([p]) => p === `/api/budget/${M}`).length).toBeGreaterThanOrEqual(4)
  })

  it('offers to copy last month into an empty month', async () => {
    setup({
      [`GET /api/budget/${M}`]: { lines: [], summary: EMPTY_SUMMARY },
      [`POST /api/budget/${M}/copy-previous`]: MINE,
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Copy last month' }))
    expect(api).toHaveBeenCalledWith(`/api/budget/${M}/copy-previous`, { method: 'POST' })
    expect(await screen.findByRole('listitem', { name: 'Rent' })).toBeInTheDocument()
  })

  it('shows why copying failed', async () => {
    setup({
      [`GET /api/budget/${M}`]: { lines: [], summary: EMPTY_SUMMARY },
      [`POST /api/budget/${M}/copy-previous`]: () => {
        throw new ApiError(404, 'Last month has nothing to copy')
      },
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Copy last month' }))
    expect(await screen.findByText('Last month has nothing to copy')).toBeInTheDocument()
  })

  it('switches to the read-only shared view with per-member contributions', async () => {
    setup({
      'GET /api/links': { ...NO_LINKS, linked: [{ id: 9, user_id: 2, username: 'bob', avatar: null }] },
      [`GET /api/budget/${M}`]: MINE,
      [`GET /api/budget/${M}/shared/2`]: {
        members: [{ id: 1, username: 'ann', avatar: null }, BOB],
        lines: [...MINE.lines, line(3, 'expense', 'Bob gym', '50.00', '50.00', 2)],
        summary: { ...SUMMARY, net_worth: '20000.00' },
        per_member: [
          { user_id: 1, summary: SUMMARY },
          { user_id: 2, summary: { ...EMPTY_SUMMARY, net_worth: '7654.33' } },
        ],
      },
    })
    await userEvent.click(await screen.findByRole('tab', { name: 'Shared with bob' }))
    const o = await overview()
    expect(await o.findByText('$20,000.00')).toBeInTheDocument()
    expect(within(screen.getByRole('listitem', { name: 'Bob gym' })).getByTitle('bob')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Add|Edit|Delete)/ })).not.toBeInTheDocument()
    const contrib = within(screen.getByRole('region', { name: 'Contributions' }))
    expect(contrib.getByText('$7,654.33')).toBeInTheDocument()
    expect(contrib.getByText('$12,345.67')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Mine' }))
    expect(await o.findByText('$12,345.67')).toBeInTheDocument()
  })

  it('hides the view switcher without linked accounts', async () => {
    setup({ [`GET /api/budget/${M}`]: MINE })
    await overview()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })
})
