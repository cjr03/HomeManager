// Mikayla's neural voice, off the main thread: the model would freeze the page while it speaks.
import { KokoroTTS } from 'kokoro-js'

// On the GPU it speaks ~4x faster than real time; on the CPU (wasm) it was 5x slower, so without WebGPU she keeps the
// browser's voice. Full precision only: against the CPU's fp32 output, fp32 on the GPU matched (23.9dB SNR) but fp16
// came out garbled (0.3dB, the error as loud as her voice). ~325MB on first use; the browser caches it after that.
const tts = KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'fp32', device: 'webgpu' })
// The first sentence compiles the GPU shaders (~2.5s), so do that now rather than on her first reply.
const warm = tts.then((model) => model.generate('Hi.', { voice: 'af_heart' }))
warm.then(
  () => postMessage({ ready: true }),
  () => postMessage({ ready: false }),
)

// One sentence at a time: the model can't run two at once.
let queue: Promise<unknown> = warm
onmessage = ({ data: text }: MessageEvent<string>) => {
  queue = queue
    .then(async () => {
      const { audio, sampling_rate } = await (await tts).generate(text, { voice: 'af_heart', speed: 1 })
      postMessage({ audio, sampling_rate }, { transfer: [audio.buffer] })
    })
    .catch(() => postMessage({})) // no audio: she says this one in the browser's voice
}
