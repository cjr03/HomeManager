// Shared by component tests. Each test file must also call:
//   vi.mock('@/lib/api', async (orig) => ({ ...(await orig()), api: vi.fn() }))
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'
import App from '@/App'
import { api, ApiError } from '@/lib/api'
import type { User } from '@/lib/auth'

export const USER: User = {
  id: 1,
  email: 'ann@example.com',
  username: 'ann',
  household_size: 2,
  avatar: null,
  preferences: {
    diet: 'none',
    allergies: [],
    dislikes: '',
    favorite_cuisines: [],
    cooking_time: 'moderate',
    budget_level: 'moderate',
  },
}

type Init = { method?: string; json?: unknown; body?: unknown }

/** Route api() calls by "METHOD /path" to a value or a function of the request init. Unmocked routes 404. */
export function mockApi(routes: Record<string, unknown>) {
  const impl = async (path: string, init: Init = {}) => {
    const key = `${init.method ?? 'GET'} ${path}`
    if (!(key in routes)) throw new ApiError(404, `unmocked ${key}`)
    const r = routes[key]
    return typeof r === 'function' ? r(init) : r
  }
  vi.mocked(api).mockImplementation(impl as typeof api)
}

export const unauthorized = () => {
  throw new ApiError(401, 'Not authenticated')
}

export function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}
