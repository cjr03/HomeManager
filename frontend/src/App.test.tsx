import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import App from './App'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('App routes and shell', () => {
  it('redirects / to the meals page inside the shell', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { level: 1, name: 'Meals' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Meals' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('HomeManager')).toBeInTheDocument()
  })

  it.each([
    ['/meals', 'Meals'],
    ['/budget', 'Budget'],
    ['/calendar', 'Calendar'],
  ])('%s renders a monthly page with month navigation', (path, title) => {
    renderAt(path)
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next month' })).toBeInTheDocument()
  })

  it('renders the account page', () => {
    renderAt('/account')
    expect(screen.getByRole('heading', { level: 1, name: 'Account' })).toBeInTheDocument()
  })

  it('renders the login page without the app navigation', () => {
    renderAt('/login')
    expect(screen.getByRole('heading', { level: 1, name: /welcome/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Budget' })).not.toBeInTheDocument()
  })

  it('navigates between pages and moves the active state', async () => {
    renderAt('/meals')
    await userEvent.click(screen.getByRole('link', { name: 'Budget' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Budget' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Budget' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Meals' })).not.toHaveAttribute('aria-current')
  })

  it('page month navigation changes the displayed month', async () => {
    renderAt('/calendar')
    const before = screen.getByRole('heading', { level: 2 }).textContent
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByRole('heading', { level: 2 }).textContent).not.toBe(before)
  })
})
