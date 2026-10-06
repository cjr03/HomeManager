import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('api', () => {
  it('GETs with credentials and returns parsed JSON', async () => {
    const fetch = mockFetch(200, { status: 'ok' })
    await expect(api<{ status: string }>('/api/health')).resolves.toEqual({ status: 'ok' })
    expect(fetch).toHaveBeenCalledWith('/api/health', expect.objectContaining({ credentials: 'include' }))
  })

  it('serialises a json body and sets the content type', async () => {
    const fetch = mockFetch(201, { id: 1 })
    await api('/api/things', { method: 'POST', json: { name: 'milk' } })
    const init = fetch.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"name":"milk"}')
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
  })

  it('keeps caller headers alongside the json content type', async () => {
    const fetch = mockFetch(200, {})
    await api('/api/x', { json: {}, headers: { 'X-Test': '1' } })
    const headers = new Headers((fetch.mock.calls[0][1] as RequestInit).headers)
    expect(headers.get('X-Test')).toBe('1')
    expect(headers.get('Content-Type')).toBe('application/json')
  })

  it('returns undefined for 204 No Content', async () => {
    mockFetch(204)
    await expect(api('/api/things/1', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('throws ApiError with the FastAPI string detail', async () => {
    mockFetch(401, { detail: 'Invalid credentials' })
    const err = await api('/api/auth/login').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 401, detail: 'Invalid credentials', message: 'Invalid credentials' })
  })

  it('joins FastAPI validation error messages', async () => {
    mockFetch(422, { detail: [{ msg: 'Field required' }, { msg: 'Too short' }] })
    await expect(api('/api/x')).rejects.toMatchObject({ status: 422, detail: 'Field required; Too short' })
  })

  it('falls back to the status text when the body has no detail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('oops', { status: 500, statusText: 'Server Error' })))
    await expect(api('/api/x')).rejects.toMatchObject({ status: 500, detail: 'Server Error' })
  })
})
