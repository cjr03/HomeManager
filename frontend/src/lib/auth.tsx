import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router'
import { api } from '@/lib/api'

export type Preferences = {
  diet: string
  allergies: string[]
  dislikes: string
  favorite_cuisines: string[]
  cooking_time: string
  budget_level: string
}

export type User = {
  id: number
  email: string
  username: string
  household_size: number
  preferences: Preferences
  avatar: string | null
}

type Auth = {
  /** undefined while the first /api/me is loading, null when signed out. */
  user: User | null | undefined
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>()
  const refresh = useCallback(async () => setUser(await api<User>('/api/me').catch(() => null)), [])
  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' })
    setUser(null)
  }, [])
  useEffect(() => void refresh(), [refresh])
  return <AuthContext value={{ user, refresh, logout }}>{children}</AuthContext>
}

export function useAuth() {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>')
  return auth
}

/** Signed-in user for pages rendered under <RequireAuth>. */
export function useUser() {
  return useAuth().user!
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user === undefined) return null
  return user ? children : <Navigate to="/login" replace />
}
