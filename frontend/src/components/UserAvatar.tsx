import { cn } from '@/lib/utils'

export function UserAvatar({ username, avatar, className }: { username: string; avatar: string | null; className?: string }) {
  return avatar ? (
    <img src={avatar} alt="" className={cn('size-9 shrink-0 rounded-full object-cover', className)} />
  ) : (
    <span
      aria-hidden
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-full bg-accent font-semibold text-accent-foreground uppercase',
        className,
      )}
    >
      {username[0]}
    </span>
  )
}
