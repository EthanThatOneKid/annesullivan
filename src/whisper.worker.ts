import { env, pipeline } from '@huggingface/transformers';

if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;

type WorkerMessage =
  | { type: 'INIT'; model?: string }
  | { type: 'TRANSCRIBE'; audioData: Float32Array; sampleRate: number };

type WorkerResponse =
  | { status: 'loading'; message: string }
  | { status: 'ready'; model: string }
  | { status: 'transcribing' }
  | { status: 'done'; text: string; chunks?: Array<{ text: string; timestamp: [number, number] }> }
  | { status: 'error'; message: string };

type TranscriberResult = { text: string; chunks?: Array<{ text: string; timestamp: [number, number] }> };
type Transcriber = (audio: Float32Array, options: { return_timestamps: true; chunk_length_s: number; stride_length_s: number }) => Promise<TranscriberResult>;
let transcriber: Transcriber | null = null;
let activeModel = 'Xenova/whisper-tiny.en';

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  try {
    if (event.data.type === 'INIT') {
      activeModel = event.data.model ?? activeModel;
      self.postMessage({ status: 'loading', message: `Loading ${activeModel} locally…` } satisfies WorkerResponse);
      transcriber = await (pipeline as unknown as (...args: unknown[]) => Promise<unknown>)('automatic-speech-recognition', activeModel, {
        device: 'webgpu',
        dtype: 'q4',
      }) as Transcriber;
      self.postMessage({ status: 'ready', model: activeModel } satisfies WorkerResponse);
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
