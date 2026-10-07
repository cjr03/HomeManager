import { Loader2, Mic, Send, VolumeX, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { errorText, FormError } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import mikayla from '@/assets/mikayla.jpg'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { assistantTarget } from '@/lib/assistant'
import { useAuth } from '@/lib/auth'
import { today } from '@/lib/month'
import { cn } from '@/lib/utils'
import { prime, recognizer, speak, type Recognition } from '@/lib/voice'

type Message = { role: 'user' | 'assistant'; content: string }

const HINTS: Record<string, string> = {
  meals: 'Add to the pantry, change preferences, plan meals or build the shopping list.',
  budget: "Add, change or remove lines in this month's plan, what you own and what you owe, or ask about the numbers.",
  calendar: 'Add, change or remove chores, and mark chores, tasks or events done.',
  account: "Mark today's chores or tasks done, or change your household preferences.",
}
const MAX_LENGTH = 4000

/** Chat about the current page. A sticky column on xl screens, a floating sheet on smaller ones. */
export function AssistantPanel() {
  const page = useLocation().pathname.split('/')[1]
  const { refresh } = useAuth()
  const [histories, setHistories] = useState<Record<string, Message[]>>({})
  const [draft, setDraft] = useState('')
  const [busyPage, setBusyPage] = useState<string | null>(null) // the page waiting on a reply
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const list = useRef<HTMLUListElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const recognition = useRef<Recognition | null>(null)
  const turn = useRef(0) // bumped whenever voice stops, so a reply still on its way isn't read out
  const latestSend = useRef(send) // recognition outlives the render that started it
  const messages = histories[page] ?? []
  const busy = busyPage === page

  // Stop listening and talking, without sending what was heard.
  function quiet() {
    turn.current++
    const r = recognition.current
    recognition.current = null
    if (r) {
      r.onend = null
      r.abort()
    }
    window.speechSynthesis?.cancel()
    setListening(false)
    setSpeaking(false)
  }

  useEffect(() => {
    setError('')
    return quiet // on leaving the page, and on logout
  }, [page])
  // The sheet below xl: focus moves in on open and back to the trigger on close; Escape closes it from anywhere.
  useEffect(() => {
    if (open) document.getElementById('assistant-message')?.focus()
    else if (wasOpen.current) {
      trigger.current?.focus()
      quiet()
    }
    wasOpen.current = open
    if (!open) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [open])
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight
  }, [messages.length, busy])

  if (!(page in HINTS)) return null

  async function send(content = draft.trim(), spoken = false) {
    if (!content || busy || (listening && !spoken)) return
    const sentTurn = turn.current
    const sent = [...messages, { role: 'user' as const, content }]
    const set = (m: Message[]) => setHistories((h) => ({ ...h, [page]: m }))
    set(sent)
    setDraft('')
    setError('')
    setBusyPage(page)
    const { context } = assistantTarget()
    try {
      const res = await api<{ reply: string; changed: boolean }>('/api/assistant', {
        method: 'POST',
        // The API takes at most 40 messages, starting with the user's; history alternates, so 39 keeps that.
        json: {
          page,
          today: today(),
          context,
          messages: sent.slice(-39).map((m) => ({ ...m, content: m.content.slice(0, MAX_LENGTH) })),
        },
      })
      set([...sent, { role: 'assistant', content: res.reply }])
      if (spoken && sentTurn === turn.current) {
        setSpeaking(true)
        speak(res.reply, () => sentTurn === turn.current && setSpeaking(false))
      }
      if (res.changed) {
        assistantTarget().onChanged() // the page showing now, which may have remounted since sending
        await refresh()
      }
    } catch (err) {
      set(messages)
      setDraft((d) => d || content)
      setError(errorText(err))
    } finally {
      setBusyPage((p) => (p === page ? null : p))
    }
  }

  latestSend.current = send

  // Talking interrupts her. What was heard is added to the box as you speak and sends itself once you stop.
  function listen() {
    if (recognition.current) return recognition.current.stop()
    turn.current++
    prime()
    setSpeaking(false)
    const Recognizer = recognizer()!
    const r = new Recognizer()
    const typed = draft.trim()
    let heard = ''
    r.lang = 'en-US'
    r.interimResults = true
    r.onresult = (e) => {
      heard = `${typed} ${Array.from(e.results, (result) => result[0].transcript).join('')}`.trim()
      setDraft(heard)
    }
    r.onerror = (e) => {
      heard = ''
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setError('Allow microphone access to talk to Mikayla.')
      else if (e.error !== 'no-speech' && e.error !== 'aborted') setError("Couldn't hear that. Try again or type it.")
    }
    r.onend = () => {
      recognition.current = null
      setListening(false)
      if (heard) void latestSend.current(heard, true)
    }
    recognition.current = r
    setError('')
    setListening(true)
    r.start()
  }

  return (
    <>
      <Button
        ref={trigger}
        className="fixed right-4 bottom-24 z-40 size-12 overflow-hidden rounded-full p-0 shadow-float sm:bottom-6 xl:hidden"
        aria-label="Open Mikayla"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <img src={mikayla} alt="" className="size-full object-cover" />
      </Button>
      <aside
        aria-label="Mikayla"
        className={cn(
          'fixed inset-x-3 bottom-24 z-50 h-[min(28rem,calc(100svh-7rem))] sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-80',
          'xl:sticky xl:inset-auto xl:top-4 xl:z-auto xl:block xl:h-[min(32rem,calc(100svh-2rem))] xl:w-auto',
          open ? 'block' : 'hidden',
        )}
      >
        <Card className="h-full gap-3 py-4">
          <div className="flex items-center gap-2 px-4">
            <img src={mikayla} alt="" className="size-8 rounded-full object-cover" />
            <h2 className="flex-1 font-semibold">Mikayla</h2>
            {speaking && (
              <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Stop talking" onClick={quiet}>
                <VolumeX />
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" className="rounded-full xl:hidden" aria-label="Close Mikayla" onClick={() => setOpen(false)}>
              <X />
            </Button>
          </div>
          <ul ref={list} aria-live="polite" className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 text-sm">
            {!messages.length && <li className="text-muted-foreground">{HINTS[page]}</li>}
            {messages.map((m, i) => (
              <li
                key={i}
                className={cn(
                  'max-w-[85%] rounded-2xl px-3 py-2 whitespace-pre-wrap',
                  m.role === 'user' ? 'self-end bg-primary text-primary-foreground' : 'self-start bg-muted',
                )}
              >
                {m.content}
              </li>
            ))}
            {busy && (
              <li className="flex items-center gap-2 self-start text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Thinking…
              </li>
            )}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
            className="space-y-2 px-4"
          >
            <FormError>{error}</FormError>
            <div className="flex items-end gap-2">
              <label htmlFor="assistant-message" className="sr-only">
                Message Mikayla
              </label>
              <Textarea
                id="assistant-message"
                rows={1}
                maxLength={MAX_LENGTH}
                placeholder={listening ? 'Listening…' : 'Ask or tell me what to change'}
                className="max-h-32 min-h-10 resize-none"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void send()
                  }
                }}
              />
              {recognizer() && (
                <Button
                  type="button"
                  size="icon"
                  variant={listening ? 'default' : 'outline'}
                  className={cn('shrink-0 rounded-full', listening && 'animate-pulse')}
                  aria-label="Talk to Mikayla"
                  aria-pressed={listening}
                  disabled={busy}
                  onClick={listen}
                >
                  <Mic />
                </Button>
              )}
              <Button type="submit" size="icon" className="shrink-0 rounded-full" aria-label="Send" disabled={busy || listening || !draft.trim()}>
                <Send />
              </Button>
            </div>
          </form>
        </Card>
      </aside>
    </>
  )
}
