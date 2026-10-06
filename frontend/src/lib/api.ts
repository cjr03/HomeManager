export class ApiError extends Error {
  status: number
  detail: string

  constructor(status: number, detail: string) {
    super(detail)
    this.status = status
    this.detail = detail
  }
}

type Init = RequestInit & { json?: unknown }

export async function api<T = unknown>(path: string, { json, ...init }: Init = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (json !== undefined) headers.set('Content-Type', 'application/json')
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
    body: json !== undefined ? JSON.stringify(json) : init.body,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const d = body?.detail
    const detail =
      typeof d === 'string' ? d : Array.isArray(d) ? d.map((e: { msg: string }) => e.msg).join('; ') : res.statusText
    throw new ApiError(res.status, detail)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}
