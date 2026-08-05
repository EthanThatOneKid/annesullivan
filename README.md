# Anne Sullivan

Anne Sullivan is a private-by-default, browser-native media workbench. Drop in an audio or video file to inspect existing captions, identify descriptive-audio tracks where the browser exposes them, extract a playable audio recording, and prepare a local transcription / structured-extraction workflow.

The name is a reference to the teacher and interpreter who helped Helen Keller turn experience into language. This project aims at the same bridge: media in, meaning out, without sending the media to a server.

## Current MVP

- Native file selection and drag-and-drop for audio/video.
- Local preview with browser media metadata.
- Existing WebVTT / text-track cue extraction.
- Descriptive-audio track discovery and toggling when `HTMLMediaElement.audioTracks` is available.
- Audio capture through `captureStream()` and `MediaRecorder`, with a download link.
- Browser capability diagnostics for WebGPU, Web Workers, Speech Recognition, and media capture.
- Worker boundaries prepared for local Whisper transcription and WebLLM structured extraction.
- GitHub Actions type-check, production build, and GitHub Pages deployment.

## Live preview

The current `main` build is published at https://ethanthatonekid.github.io/annesullivan/.

## Development

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. For WebGPU and WebAssembly experiments, use a current Chromium-based browser and serve over localhost or HTTPS. The first local-model implementation will be added behind the existing worker interfaces; media files remain in the browser.

```sh
npm run check
npm run build
```

## Privacy

There is no application server or upload endpoint. The MVP only reads the file selected in the browser. Model downloads, when enabled, will come from their configured model hosts and may be cached by the browser; the media itself is not sent by this app.

## Roadmap

1. Add resilient 16 kHz audio decoding and chunked Whisper transcription in the transcription worker.
2. Add optional WebLLM structured extraction with user-defined JSON Schema and a visible model download estimate.
3. Export timestamped transcripts as WebVTT, SRT, JSON, and Markdown.
4. Add keyframe extraction and media timeline annotations without making the initial workflow depend on FFmpeg.
5. Add IndexedDB model caching, cancellation, progress reporting, and regression fixtures.
