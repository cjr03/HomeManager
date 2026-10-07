import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BudgetCard, money, signedMoney, type Line, type Summary } from './BudgetCard'

const plan = (budgeted: string, actual: string, difference: string) => ({ budgeted, actual, difference })
const range = (start: string, end: string, difference: string) => ({ start, end, difference })

const SUMMARY: Summary = {
  assets: '9000.00',
  debit: range('1000.00', '1250.50', '250.50'),
  income: { pre_tax: '5000.00', post_tax: '3800.00' },
  loans: '20000.00',
  credit: range('300.00', '450.00', '150.00'),
  expenses: plan('1900.00', '2000.00', '-100.00'),
  savings: plan('500.00', '600.00', '100.00'),
  remainder: plan('1400.00', '1200.00', '-200.00'),
  net_worth: '-10199.50',
}

const line = (id: number, kind: Line['kind'], name: string, a: string, b: string | null = null, owner_id = 1): Line => ({
  id, owner_id, partner_id: null, user_share: 50, partner_share: 50, month: '2026-10', kind, name, a, b, position: id,
})

const EXPENSES = [line(1, 'expense', 'Rent', '1500.00', '1500.00'), line(2, 'expense', 'Food', '400.00', '500.00')]

describe('money', () => {
  it('formats currency and signs differences', () => {
    expect(money('1234.5')).toBe('$1,234.50')
    expect(money('-3')).toBe('-$3.00')
    expect(signedMoney('70.3')).toBe('+$70.30')
    expect(signedMoney('-70.3')).toBe('-$70.30')
    expect(signedMoney('0')).toBe('$0.00')
  })
})

describe('BudgetCard', () => {
  function renderCard(props: Partial<Parameters<typeof BudgetCard>[0]> = {}) {
    const handlers = { onAdd: vi.fn(), onUpdate: vi.fn(), onDelete: vi.fn() }
    render(<BudgetCard kind="expense" lines={EXPENSES} summary={SUMMARY} {...handlers} {...props} />)
    return handlers
  }

  it('lists rows, totals and the semantic difference', () => {
    renderCard()
    expect(screen.getByRole('heading', { name: 'Expenses' })).toBeInTheDocument()
    const food = screen.getByRole('listitem', { name: 'Food' })
    expect(within(food).getByText('$400.00')).toBeInTheDocument()
    expect(within(food).getByText('$500.00')).toBeInTheDocument()
    expect(within(food).getByRole('meter', { name: 'Food spent of budget' })).toHaveAttribute('aria-valuenow', '500')
    expect(screen.getByText('$1,900.00')).toBeInTheDocument()
    expect(screen.getByText('$2,000.00')).toBeInTheDocument()
    // expenses: actual over budget is bad, shown with a minus sign and a label, not colour alone
    expect(screen.getByText('-$100.00').closest('[data-tone]')).toHaveAttribute('data-tone', 'bad')
    expect(screen.getByText('Needs attention')).toBeInTheDocument()
  })

  it('treats a rising credit balance as bad and a rising debit balance as good', () => {
    const { unmount } = render(<BudgetCard kind="credit" lines={[]} summary={SUMMARY} />)
    expect(screen.getByText('+$150.00').closest('[data-tone]')).toHaveAttribute('data-tone', 'bad')
    unmount()
    render(<BudgetCard kind="debit" lines={[]} summary={SUMMARY} />)
    expect(screen.getByText('+$250.50').closest('[data-tone]')).toHaveAttribute('data-tone', 'good')
  })

  it('caps meters at full and only flags overspending, not oversaving', () => {
    const fill = (name: string) => screen.getByRole('meter', { name }).firstElementChild as HTMLElement
    const { unmount } = render(<BudgetCard kind="expense" lines={EXPENSES} summary={SUMMARY} />)
    expect(fill('Food spent of budget')).toHaveStyle({ width: '100%' })
    expect(fill('Food spent of budget')).toHaveClass('bg-destructive')
    expect(fill('Rent spent of budget')).toHaveClass('bg-primary')
    unmount()
    const lines = [line(3, 'savings', 'Holiday', '300.00', '450.00'), line(4, 'savings', 'Rainy day', '0.00', '0.00')]
    render(<BudgetCard kind="savings" lines={lines} summary={{ ...SUMMARY, savings: plan('300.00', '450.00', '0.00') }} />)
    expect(fill('Holiday saved of goal')).toHaveStyle({ width: '100%' })
    expect(fill('Holiday saved of goal')).toHaveClass('bg-primary')
    expect(fill('Rainy day saved of goal')).toHaveStyle({ width: '0%' })
    expect(screen.getByText('Versus goal').nextElementSibling).toHaveAttribute('data-tone', 'neutral')
  })

  it('adds a line', async () => {
    const { onAdd } = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Add expense' }))
    await userEvent.type(screen.getByLabelText('Name'), 'Gym')
    await userEvent.type(screen.getByLabelText('Budgeted'), '45')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onAdd).toHaveBeenCalledWith({ name: 'Gym', a: '45', b: null })
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
  })

  it('edits a line inline', async () => {
    const { onUpdate } = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Edit Food' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Food')
    const actual = screen.getByLabelText('Actual')
    await userEvent.clear(actual)
    await userEvent.type(actual, '432.10')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onUpdate).toHaveBeenCalledWith(2, { name: 'Food', a: '400.00', b: '432.1' })
  })

  it('cancels an edit without saving', async () => {
    const { onUpdate } = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Edit Rent' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByRole('listitem', { name: 'Rent' })).toBeInTheDocument()
  })

  it('deletes a line', async () => {
    const { onDelete } = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Delete Rent' }))
    expect(onDelete).toHaveBeenCalledWith(1)
  })

  it('is read-only without handlers', () => {
    render(<BudgetCard kind="expense" lines={EXPENSES} summary={SUMMARY} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  describe('shared view', () => {
    const members = [{ id: 1, username: 'ann', avatar: null }, { id: 2, username: 'bob', avatar: null }]
    // Rent is ann's (me) at 70/30; Food is bob's, giving ann 100 and bob 100.
    const lines = [{ ...EXPENSES[0], partner_id: 2, user_share: 70, partner_share: 30 }, { ...EXPENSES[1], owner_id: 2, partner_id: 1, user_share: 100, partner_share: 100 }]
    const renderShared = () => {
      const handlers = { onAdd: vi.fn(), onUpdate: vi.fn(), onDelete: vi.fn() }
      render(<BudgetCard kind="expense" lines={lines} summary={SUMMARY} members={members} {...handlers} />)
      return handlers
    }

    it('shows each split from my side', () => {
      renderShared()
      expect(within(screen.getByRole('listitem', { name: 'Rent' })).getByText('70/30 split')).toBeInTheDocument()
      expect(within(screen.getByRole('listitem', { name: 'Food' })).getByText('100/100 split')).toBeInTheDocument()
    })

    it('adds a line with a split, 50/50 by default', async () => {
      const { onAdd } = renderShared()
      await userEvent.click(screen.getByRole('button', { name: 'Add expense' }))
      expect(screen.getByLabelText('Your share %')).toHaveValue(50)
      await userEvent.type(screen.getByLabelText('Name'), 'Gas')
      await userEvent.type(screen.getByLabelText('Budgeted'), '80')
      await userEvent.clear(screen.getByLabelText("bob's share %"))
      await userEvent.type(screen.getByLabelText("bob's share %"), '100')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(onAdd).toHaveBeenCalledWith({ name: 'Gas', a: '80', b: null, user_share: 50, partner_share: 100 })
    })

    it("maps my split back onto the owner's side when editing someone else's line", async () => {
      const { onUpdate } = renderShared()
      await userEvent.click(screen.getByRole('button', { name: 'Edit Food' }))
      await userEvent.clear(screen.getByLabelText('Your share %'))
      await userEvent.type(screen.getByLabelText('Your share %'), '25')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(onUpdate).toHaveBeenCalledWith(2, expect.objectContaining({ user_share: 100, partner_share: 25 }))
    })
  })

  it('marks your share of a shared line as read-only in the personal view', () => {
    renderCard({ lines: [EXPENSES[0], { ...EXPENSES[1], partner_id: 2 }] })
    expect(within(screen.getByRole('listitem', { name: 'Food' })).getByText('Shared')).toBeInTheDocument()
    expect(screen.queryByLabelText('Your share %')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Food' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Rent' })).toBeInTheDocument()
  })
})
