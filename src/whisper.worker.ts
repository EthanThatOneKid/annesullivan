import { env, pipeline } from '@huggingface/transformers';

if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;

type WorkerMessage =
  | { type: 'INIT'; model?: string; device?: 'webgpu' | 'wasm' }
  | { type: 'TRANSCRIBE'; audioData: Float32Array; sampleRate: number };

type WorkerResponse =
  | { status: 'loading'; message: string }
  | { status: 'fallback'; message: string }
  | { status: 'ready'; model: string; device: 'webgpu' | 'wasm' }
  | { status: 'transcribing' }
  | { status: 'done'; text: string; chunks?: Array<{ text: string; timestamp: [number, number] }> }
  | { status: 'error'; message: string };

type TranscriberResult = { text: string; chunks?: Array<{ text: string; timestamp: [number, number] }> };
type Transcriber = (audio: Float32Array, options: { return_timestamps: true; chunk_length_s: number; stride_length_s: number }) => Promise<TranscriberResult>;
let transcriber: Transcriber | null = null;
let activeModel = 'Xenova/whisper-tiny.en';
let activeDevice: 'webgpu' | 'wasm' = 'wasm';

async function loadTranscriber(device: 'webgpu' | 'wasm') {
  const options = device === 'webgpu' ? { device, dtype: 'q4' } : { device };
  return (pipeline as unknown as (...args: unknown[]) => Promise<unknown>)('automatic-speech-recognition', activeModel, options) as Promise<Transcriber>;
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  try {
    if (event.data.type === 'INIT') {
      activeModel = event.data.model ?? activeModel;
      activeDevice = event.data.device ?? 'wasm';
      self.postMessage({ status: 'loading', message: `Loading ${activeModel} locally with ${activeDevice === 'webgpu' ? 'WebGPU' : 'CPU/WASM'}…` } satisfies WorkerResponse);
      try {
        transcriber = await loadTranscriber(activeDevice);
      } catch (error) {
        if (activeDevice !== 'webgpu') throw error;
        activeDevice = 'wasm';
        self.postMessage({ status: 'fallback', message: 'WebGPU could not provide an adapter. Retrying Whisper with the CPU/WASM backend…' } satisfies WorkerResponse);
        transcriber = await loadTranscriber(activeDevice);
      }
      self.postMessage({ status: 'ready', model: activeModel, device: activeDevice } satisfies WorkerResponse);
      return;
    }

    if (event.data.type === 'TRANSCRIBE') {
      if (!transcriber) throw new Error('Initialize the transcription model first.');
      self.postMessage({ status: 'transcribing' } satisfies WorkerResponse);
      const result = await transcriber(event.data.audioData, {
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      self.postMessage({ status: 'done', text: result.text, chunks: result.chunks } satisfies WorkerResponse);
    }
  } catch (error) {
    self.postMessage({ status: 'error', message: error instanceof Error ? error.message : String(error) } satisfies WorkerResponse);
  }
};
