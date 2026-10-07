import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '@/lib/api'
import { validateAccount } from '@/pages/LoginPage'
import { USER, mockApi, renderAt, unauthorized } from '@/test-utils'

vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: vi.fn() }))

const good = { email: 'ann@example.com', username: 'ann_1', password: 'Secret-pw1', password_confirm: 'Secret-pw1' }

describe('validateAccount', () => {
  it('accepts a valid account', () => {
    expect(validateAccount(good)).toEqual({})
  })

  it.each(['a', 'x'.repeat(14)])('accepts username %s', (username) => {
    expect(validateAccount({ ...good, username })).toEqual({})
  })

  it.each([
    [{ email: 'nope' }, 'email'],
    [{ username: '' }, 'username'],
    [{ username: 'has space' }, 'username'],
    [{ username: 'x'.repeat(15) }, 'username'],
    [{ password: 'short', password_confirm: 'short' }, 'password'],
    [{ password: 'Abcdef1!', password_confirm: 'Abcdef1!' }, 'password'],
    [{ password: 'abcdefg1!', password_confirm: 'abcdefg1!' }, 'password'],
    [{ password: 'ABCDEFG1!', password_confirm: 'ABCDEFG1!' }, 'password'],
    [{ password: 'Abcdefgh!', password_confirm: 'Abcdefgh!' }, 'password'],
    [{ password: 'Abcdefgh1', password_confirm: 'Abcdefgh1' }, 'password'],
    [{ password_confirm: 'Secret-px1' }, 'password_confirm'],
  ])('flags %o', (over, field) => {
    expect(Object.keys(validateAccount({ ...good, ...over }))).toEqual([field])
  })
})

async function fillStep1(over: Partial<typeof good> = {}) {
  const v = { ...good, ...over }
  await userEvent.type(screen.getByLabelText('Email'), v.email)
  await userEvent.type(screen.getByLabelText('Username'), v.username)
  await userEvent.type(screen.getByLabelText('Password', { exact: true }), v.password)
  await userEvent.type(screen.getByLabelText('Confirm password'), v.password_confirm)
}

const currentStep = () => screen.getByRole('list', { name: 'Sign-up progress' }).querySelector('[aria-current="step"]')

describe('LoginPage', () => {
  let me: unknown
  beforeEach(() => {
    me = null
    vi.mocked(api).mockReset()
  })

  it('shows one card with log in and sign up options', async () => {
    mockApi({ 'GET /api/me': unauthorized })
    renderAt('/login')
    expect(await screen.findByRole('tab', { name: 'Log in' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Sign up' })).toBeInTheDocument()
  })

  it('shows an inline error when login fails', async () => {
    mockApi({
      'GET /api/me': unauthorized,
      'POST /api/auth/login': () => {
        throw new ApiError(401, 'Invalid username or password')
      },
    })
    renderAt('/login')
    await userEvent.type(await screen.findByLabelText('Username'), 'ann')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-pass')
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password')
    expect(api).toHaveBeenCalledWith('/api/auth/login', {
      method: 'POST',
      json: { username: 'ann', password: 'wrong-pass' },
    })
  })

  it('logs in and lands on meals', async () => {
    mockApi({
      'GET /api/me': () => me ?? unauthorized(),
      'POST /api/auth/login': () => (me = USER),
    })
    renderAt('/login')
    await userEvent.type(await screen.findByLabelText('Username'), 'ann')
    await userEvent.type(screen.getByLabelText('Password'), 'Secret-pw1')
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Meals' })).toBeInTheDocument()
  })

  it('validates the account phase before moving on', async () => {
    mockApi({ 'GET /api/me': unauthorized })
    renderAt('/login')
    await userEvent.click(await screen.findByRole('tab', { name: 'Sign up' }))
    expect(currentStep()).toHaveTextContent('Account')

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Enter a valid email')).toBeInTheDocument()
    expect(currentStep()).toHaveTextContent('Account')

    await fillStep1({ password_confirm: 'different' })
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument()
    expect(screen.queryByText('Enter a valid email')).not.toBeInTheDocument()
    expect(currentStep()).toHaveTextContent('Account')
  })

  it('progresses through all phases, keeps values on Back, and signs up', async () => {
    mockApi({
      'GET /api/me': () => me ?? unauthorized(),
      'POST /api/auth/signup': () => (me = USER),
    })
    renderAt('/login')
    await userEvent.click(await screen.findByRole('tab', { name: 'Sign up' }))
    await fillStep1()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(currentStep()).toHaveTextContent('Household')
    const size = screen.getByLabelText('People in your household')
    expect(size).toHaveValue(1)
    await userEvent.click(screen.getByRole('button', { name: 'More people' }))
    await userEvent.click(screen.getByRole('button', { name: 'More people' }))
    expect(size).toHaveValue(3)

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(currentStep()).toHaveTextContent('Account')
    expect(screen.getByLabelText('Email')).toHaveValue('ann@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByLabelText('People in your household')).toHaveValue(3)
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(currentStep()).toHaveTextContent('Tastes')
    const diet = screen.getByRole('group', { name: 'Diet' })
    await userEvent.click(within(diet).getByRole('button', { name: 'Vegetarian' }))
    expect(within(diet).getByRole('button', { name: 'Vegetarian' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(diet).getByRole('button', { name: 'No restrictions' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Peanuts' }))
    await userEvent.click(screen.getByRole('button', { name: 'Thai' }))
    await userEvent.click(screen.getByRole('button', { name: 'Italian' }))
    await userEvent.click(screen.getByRole('button', { name: 'Italian' })) // toggles off
    await userEvent.click(screen.getByRole('button', { name: 'Quick' }))
    await userEvent.click(screen.getByRole('button', { name: 'Thrifty' }))
    await userEvent.type(screen.getByLabelText('Dislikes'), 'olives')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(api).toHaveBeenCalledWith('/api/auth/signup', {
      method: 'POST',
      json: {
        ...good,
        household_size: 3,
        preferences: {
          diet: 'vegetarian',
          allergies: ['peanuts'],
          dislikes: 'olives',
          favorite_cuisines: ['Thai'],
          cooking_time: 'quick',
          budget_level: 'thrifty',
        },
      },
    })
    expect(await screen.findByRole('heading', { level: 1, name: 'Meals' })).toBeInTheDocument()
  })

  it('returns to the account phase with the error on 409', async () => {
    mockApi({
      'GET /api/me': unauthorized,
      'POST /api/auth/signup': () => {
        throw new ApiError(409, 'Username already taken')
      },
    })
    renderAt('/login')
    await userEvent.click(await screen.findByRole('tab', { name: 'Sign up' }))
    await fillStep1()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Username already taken')
    expect(currentStep()).toHaveTextContent('Account')
    expect(screen.getByLabelText('Username')).toHaveValue('ann_1')
  })
})
