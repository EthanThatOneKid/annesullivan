import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

env.backends.onnx.wasm.numThreads = 1;

type WorkerMessage =
  | { type: 'INIT'; model?: string }
  | { type: 'TRANSCRIBE'; audioData: Float32Array; sampleRate: number };

type WorkerResponse =
  | { status: 'loading'; message: string }
  | { status: 'ready'; model: string }
  | { status: 'transcribing' }
  | { status: 'done'; text: string; chunks?: Array<{ text: string; timestamp: [number, number] }> }
  | { status: 'error'; message: string };

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let activeModel = 'Xenova/whisper-tiny.en';

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  try {
    if (event.data.type === 'INIT') {
      activeModel = event.data.model ?? activeModel;
      self.postMessage({ status: 'loading', message: `Loading ${activeModel} locally…` } satisfies WorkerResponse);
      transcriber = await pipeline('automatic-speech-recognition', activeModel, {
        device: 'webgpu',
        dtype: 'q4',
      });
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
      const normalized = Array.isArray(result) ? result[0] : result;
      const chunks = 'chunks' in normalized && normalized.chunks
        ? normalized.chunks.map((chunk) => ({ text: chunk.text, timestamp: chunk.timestamp as [number, number] }))
        : undefined;
      self.postMessage({ status: 'done', text: normalized.text, chunks } satisfies WorkerResponse);
    }
  } catch (error) {
    self.postMessage({ status: 'error', message: error instanceof Error ? error.message : String(error) } satisfies WorkerResponse);
  }
};
