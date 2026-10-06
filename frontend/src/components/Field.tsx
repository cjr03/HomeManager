import type { ComponentProps, ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'

export const errorText = (err: unknown) => (err instanceof ApiError ? err.detail : 'Something went wrong, try again')

export function FormError({ children }: { children: ReactNode }) {
  return children ? (
    <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {children}
    </p>
  ) : null
}

export function Field({
  id,
  label,
  error,
  ...props
}: { id: string; label: string; error?: string } & ComponentProps<typeof Input>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} {...props} />
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
