import { afterEach, describe, expect, it, vi } from 'vitest'
import { pickVoice, prime, RATE, speak, spellMikayla } from '@/lib/voice'

const voice = (name: string, lang = 'en-US') => ({ name, lang }) as SpeechSynthesisVoice

describe('pickVoice', () => {
  it("picks the most human-sounding US English woman's voice, never a man's", () => {
    // What Chrome on macOS offers without downloads: Google's voice beats Samantha.
    expect(pickVoice([voice('Fred'), voice('Samantha'), voice('Kathy'), voice('Google US English')])?.name).toBe('Google US English')
    expect(pickVoice([voice('Samantha'), voice('Google US English'), voice('Ava (Premium)')])?.name).toBe('Ava (Premium)')
    expect(pickVoice([voice('Microsoft David'), voice('Microsoft Aria Online (Natural) - English (United States)')])?.name).toContain('Aria')
    expect(pickVoice([voice('Amélie', 'fr-FR'), voice('Fred'), voice('Samantha', 'en_US')])?.name).toBe('Samantha')
    expect(pickVoice([voice('Microsoft David - English (United States)'), voice('Microsoft Zira - English (United States)')])?.name).toContain('Zira')
    expect(pickVoice([voice('Daniel', 'en-GB'), voice('Fred'), voice('Ava', 'en-GB')])).toBeUndefined()
  })
})

describe('spellMikayla', () => {
  it('spells her name right however recognition heard it, leaving other words alone', () => {
    expect(spellMikayla('Hey Michaela, what about mikaela and Makayla? Ask Michael.')).toBe('Hey Mikayla, what about Mikayla and Mikayla? Ask Michael.')
    expect(spellMikayla('Mikayla, add milk')).toBe('Mikayla, add milk')
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
