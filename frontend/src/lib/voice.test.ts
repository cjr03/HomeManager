import { afterEach, describe, expect, it, vi } from 'vitest'
import { pickVoice, prime, RATE, speak } from '@/lib/voice'

const voice = (name: string, lang = 'en-US') => ({ name, lang }) as SpeechSynthesisVoice

describe('pickVoice', () => {
  it('prefers a clear US English voice, then any US English one', () => {
    expect(pickVoice([voice('Fred'), voice('Samantha'), voice('Ava (Premium)')])?.name).toBe('Ava (Premium)')
    expect(pickVoice([voice('Amélie', 'fr-FR'), voice('Fred'), voice('Samantha')])?.name).toBe('Samantha')
    expect(pickVoice([voice('Daniel', 'en-GB'), voice('Fred', 'en_US')])?.name).toBe('Fred')
    expect(pickVoice([voice('Amélie', 'fr-FR')])).toBeUndefined()
  })
})

describe('speak', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('says exactly the text, fast, one sentence at a time, cutting off anything still playing', () => {
    const synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [voice('Samantha')] }
    vi.stubGlobal('speechSynthesis', synth)
    vi.stubGlobal('SpeechSynthesisUtterance', class { rate = 1; voice = null; constructor(text: string) { Object.assign(this, { text }) } })
    speak('Groceries are $12.50 this week. Want more?\nI can add rice.', () => {})
    expect(synth.cancel).toHaveBeenCalledBefore(synth.speak)
    const said = synth.speak.mock.calls.map(([u]) => u)
    expect(said.map((u) => u.text)).toEqual(['Groceries are $12.50 this week.', 'Want more?', 'I can add rice.'])
    expect(said.every((u) => u.rate === RATE && u.lang === 'en-US' && u.voice.name === 'Samantha')).toBe(true)
    expect(RATE).toBeGreaterThan(1)
  })

  it('calls back once the last sentence is done', () => {
    const synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [] }
    vi.stubGlobal('speechSynthesis', synth)
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(text: string) { Object.assign(this, { text }) } })
    const done = vi.fn()
    speak('One. Two.', done)
    const [first, last] = synth.speak.mock.calls.map(([u]) => u)
    expect(first.onend).toBeUndefined()
    last.onend()
    expect(done).toHaveBeenCalledOnce()
  })

  it('does nothing where the browser cannot speak', () => {
    vi.stubGlobal('speechSynthesis', undefined)
    expect(() => speak('Hi.', () => {})).not.toThrow()
    expect(() => prime()).not.toThrow()
  })
})
