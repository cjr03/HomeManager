import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { currentMonth } from '@/lib/month'
import { MonthNav } from './MonthNav'

describe('MonthNav', () => {
  it('shows the month label', () => {
    render(<MonthNav month="2026-10" onChange={() => {}} />)
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
  })

  it('moves to the previous and next month, rolling the year', async () => {
    const onChange = vi.fn()
    render(<MonthNav month="2026-12" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(onChange).toHaveBeenLastCalledWith('2027-01')
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(onChange).toHaveBeenLastCalledWith('2026-11')
  })

  it('jumps back to the current month', async () => {
    const onChange = vi.fn()
    render(<MonthNav month="1999-01" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(onChange).toHaveBeenCalledWith(currentMonth())
  })
})
