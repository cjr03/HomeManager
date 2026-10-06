import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { USER, mockApi, renderAt, unauthorized } from '@/test-utils'

vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: vi.fn() }))

describe('App routes and shell (signed in)', () => {
  beforeEach(() => mockApi({ 'GET /api/me': USER }))

  it('redirects / to the meals page inside the shell', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'Meals' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Meals' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('HomeManager')).toBeInTheDocument()
  })

  it.each([
    ['/meals', 'Meals'],
    ['/budget', 'Budget'],
    ['/calendar', 'Calendar'],
  ])('%s renders a monthly page with month navigation', async (path, title) => {
    renderAt(path)
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next month' })).toBeInTheDocument()
  })

  it('renders the account page', async () => {
    renderAt('/account')
    expect(await screen.findByRole('heading', { level: 1, name: 'Account' })).toBeInTheDocument()
  })

  it('redirects /login to meals when already signed in', async () => {
    renderAt('/login')
    expect(await screen.findByRole('heading', { level: 1, name: 'Meals' })).toBeInTheDocument()
  })

  it('shows the signed-in user and logs out to the login page', async () => {
    let me: unknown = USER
    mockApi({
      'GET /api/me': () => me ?? unauthorized(),
      'POST /api/auth/logout': () => {
        me = null
      },
    })
    renderAt('/meals')
    const menu = await screen.findByLabelText('Signed in as ann')
    expect(menu).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(api).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' })
    expect(await screen.findByRole('heading', { level: 1, name: /welcome/i })).toBeInTheDocument()
  })

  it('navigates between pages and moves the active state', async () => {
    renderAt('/meals')
    await userEvent.click(await screen.findByRole('link', { name: 'Budget' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Budget' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Budget' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Meals' })).not.toHaveAttribute('aria-current')
  })

  it('page month navigation changes the displayed month', async () => {
    renderAt('/calendar')
    const before = (await screen.findByRole('heading', { level: 2 })).textContent
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByRole('heading', { level: 2 }).textContent).not.toBe(before)
  })
})

describe('App routes (signed out)', () => {
  beforeEach(() => mockApi({ 'GET /api/me': unauthorized }))

  it.each(['/', '/meals', '/account'])('%s redirects to the login page', async (path) => {
    renderAt(path)
    expect(await screen.findByRole('heading', { level: 1, name: /welcome/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Budget' })).not.toBeInTheDocument()
  })
})
