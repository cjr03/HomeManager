import { afterEach, describe, expect, it, vi } from 'vitest'
import { pickVoice, prime, RATE, speak, spellMikayla, trimmed } from '@/lib/voice'

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

describe('trimmed', () => {
  it('keeps 0.1s before the first sound and 0.25s after the last, so sentences flow like speech', () => {
    const rate = 1000
    const clip = new Float32Array(2000)
    clip.fill(0.5, 500, 1500) // 0.5s silence, 1s speech, 0.5s silence
    const out = trimmed(clip, rate)
    expect(out.length).toBe(100 + 1000 + 250)
    expect(out[99]).toBe(0)
    expect(out[100]).toBe(0.5)
    expect(trimmed(clip.subarray(450, 1550), rate).length).toBe(50 + 1000 + 50) // never past the ends
  })

  it('leaves a silent clip alone', () => {
    expect(trimmed(new Float32Array(10), 1000).length).toBe(10)
  })
})

describe('her neural voice', () => {
  class FakeWorker {
    static last: FakeWorker
    onmessage: ((e: { data: unknown }) => void) | null = null
    onerror: (() => void) | null = null
    posted: string[] = []
    constructor() {
      FakeWorker.last = this
    }
    postMessage(m: string) {
      this.posted.push(m)
    }
    reply(data: unknown) {
      this.onmessage?.({ data })
    }
  }
  const sources: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onended: (() => void) | null }[] = []
  class FakeAudio {
    currentTime = 0
    destination = {}
    resume = vi.fn(async () => {})
    createBuffer = (_channels: number, length: number, rate: number) => ({ duration: length / rate, copyToChannel: vi.fn() })
    createBufferSource = () => {
      const source = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null }
      sources.push(source)
      return source
    }
  }
  const synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [] }
  const said = () => synth.speak.mock.calls.map(([u]) => u.text).filter(Boolean)
  const flush = () => new Promise((r) => setTimeout(r))
  const second = (seconds: number) => ({ audio: new Float32Array(24000 * seconds), sampling_rate: 24000 })

  // A fresh module each time: the worker and its readiness live for the page.
  async function primed(ready: boolean | null = true) {
    vi.resetModules()
    sources.length = 0
    synth.speak.mockReset()
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubGlobal('AudioContext', FakeAudio)
    vi.stubGlobal('navigator', { gpu: {} })
    vi.stubGlobal('speechSynthesis', synth)
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(text: string) { Object.assign(this, { text }) } })
    const voice = await import('@/lib/voice')
    voice.prime()
    if (ready !== null) FakeWorker.last.reply({ ready })
    synth.speak.mockReset() // prime's silent iOS unlock
    return voice
  }
  afterEach(() => vi.unstubAllGlobals())

  it('plays each sentence right after the one before, then calls back, without the browser voice', async () => {
    const { speak } = await primed()
    const done = vi.fn()
    speak('One. Two.', done)
    const w = FakeWorker.last
    expect(w.posted).toEqual(['One.'])
    w.reply(second(1))
    await flush()
    expect(sources[0].start).toHaveBeenCalledWith(0)
    expect(w.posted).toEqual(['One.', 'Two.'])
    w.reply(second(0.5))
    await flush()
    expect(sources[1].start).toHaveBeenCalledWith(1)
    expect(done).not.toHaveBeenCalled()
    sources[1].onended!()
    expect(done).toHaveBeenCalledOnce()
    expect(said()).toEqual([])
  })

  it('stops mid-reply: what plays is cut and what is still being made never plays', async () => {
    const { speak, stop } = await primed()
    const done = vi.fn()
    speak('One. Two.', done)
    const w = FakeWorker.last
    w.reply(second(1))
    await flush()
    stop()
    expect(sources[0].stop).toHaveBeenCalled()
    w.reply(second(1))
    await flush()
    expect(sources).toHaveLength(1)
    expect(done).not.toHaveBeenCalled()
  })

  it('falls back to the browser voice for the rest if a sentence fails', async () => {
    const { speak } = await primed()
    const done = vi.fn()
    speak('One. Two. Three.', done)
    const w = FakeWorker.last
    w.reply(second(1))
    await flush()
    w.reply({})
    await flush()
    expect(said()).toEqual([]) // not over her neural voice still saying 'One.'
    sources[0].onended!()
    expect(said()).toEqual(['Two.', 'Three.'])
  })

  it('splits a long run-on sentence at commas so the model says all of it', async () => {
    const { speak } = await primed()
    const long = Array.from({ length: 12 }, (_, i) => `item number ${i} of the shopping list`).join(', ') + '.'
    speak(long, () => {})
    const w = FakeWorker.last
    expect(w.posted[0].length).toBeLessThan(300)
    while (w.posted.length < 12) {
      w.reply(second(1))
      await flush()
    }
    expect(w.posted.join(' ')).toBe(long)
  })

  it('never loads the model without WebGPU', async () => {
    vi.resetModules()
    vi.stubGlobal('Worker', vi.fn())
    vi.stubGlobal('AudioContext', FakeAudio)
    vi.stubGlobal('speechSynthesis', synth)
    vi.stubGlobal('SpeechSynthesisUtterance', class {})
    ;(await import('@/lib/voice')).prime()
    expect(Worker).not.toHaveBeenCalled()
  })

  it('waits for her voice while it loads, rather than switching voices', async () => {
    const { speak } = await primed(null)
    speak('Hi.', () => {})
    await flush()
    expect(FakeWorker.last.posted).toEqual([])
    expect(said()).toEqual([])
    FakeWorker.last.reply({ ready: true })
    await flush()
    expect(FakeWorker.last.posted).toEqual(['Hi.'])
    expect(said()).toEqual([])
  })

  it('uses the browser voice if hers takes too long to load', async () => {
    const { speak } = await primed(null)
    vi.useFakeTimers()
    speak('Hi.', () => {})
    await vi.advanceTimersByTimeAsync(7999)
    expect(said()).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(said()).toEqual(['Hi.'])
    vi.useRealTimers()
  })

  it('stops waiting at once if the worker itself fails to load', async () => {
    const { speak } = await primed(null)
    FakeWorker.last.onerror!()
    speak('Hi.', () => {})
    expect(said()).toEqual(['Hi.'])
  })

  it('uses the browser voice if the model fails to load', async () => {
    const { speak } = await primed(false)
    speak('Hi.', () => {})
    expect(said()).toEqual(['Hi.'])
    expect(FakeWorker.last.posted).toEqual([])
  })
})
