import { CreateWebWorkerMLCEngine, type MLCEngine } from '@mlc-ai/web-llm';
import type { AudioTrackInfo, CaptionCue, MediaInspection } from './types';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root is missing.');

const whisperWorker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
const llmWorker = new Worker(new URL('./llm.worker.ts', import.meta.url), { type: 'module' });
let llmEngine: MLCEngine | null = null;
let selectedFile: File | null = null;
let mediaUrl: string | null = null;
let mediaElement: HTMLMediaElement | null = null;
let activeRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let lastInspection: MediaInspection | null = null;

app.innerHTML = `
  <main class="shell">
    <header class="masthead">
      <div class="eyebrow"><span class="signal-dot"></span> Edge-native media workbench</div>
      <h1>Turn what happened<br><em>into something usable.</em></h1>
      <p class="dek">Transcribe, caption, listen, and extract structure from local media. Your files stay in this browser.</p>
      <div class="privacy-note"><span>◉</span> Private by design <b>·</b> No upload endpoint <b>·</b> Open web APIs</div>
    </header>

    <section class="workbench" aria-label="Media workbench">
      <div class="drop-zone" id="drop-zone" tabindex="0" role="button" aria-label="Choose an audio or video file">
        <div class="drop-icon">↥</div>
        <div>
          <strong>Drop an audio or video file here</strong>
          <span>or <button class="text-button" id="choose-button" type="button">choose from your device</button></span>
        </div>
        <input id="file-input" type="file" accept="audio/*,video/*" hidden />
      </div>

      <div class="media-panel hidden" id="media-panel">
        <div class="panel-heading"><div><span class="section-kicker">01 / Inspect</span><h2 id="file-name">Selected media</h2></div><button class="subtle-button" id="clear-button" type="button">Clear</button></div>
        <video id="media-preview" controls playsinline></video>
        <audio id="audio-preview" controls></audio>
        <div class="stat-grid" id="media-stats"></div>
      </div>

      <div class="capability-panel" id="capability-panel">
        <div class="panel-heading"><div><span class="section-kicker">Browser readiness</span><h2>What this device can do</h2></div></div>
        <div class="capability-grid" id="capabilities"></div>
      </div>

      <div class="tools-grid">
        <section class="tool-card" id="captions-card">
          <span class="section-kicker">02 / Captions</span><h2>Existing text tracks</h2>
          <p class="muted">Pull WebVTT cues already attached to the media, with timestamps intact.</p>
          <div class="tool-actions"><button class="primary-button" id="extract-captions" type="button" disabled>Extract cues</button><button class="secondary-button" id="download-captions" type="button" disabled>Download VTT</button></div>
          <div class="result-box" id="captions-result"><span class="empty-state">No media inspected yet.</span></div>
        </section>
        <section class="tool-card" id="descriptive-card">
          <span class="section-kicker">03 / Listen</span><h2>Descriptive audio</h2>
          <p class="muted">Find and enable alternate audio tracks intended to describe visual information.</p>
          <div class="track-list" id="track-list"><span class="empty-state">Audio track metadata appears here when the browser exposes it.</span></div>
          <p class="compat-note" id="audio-track-note"></p>
        </section>
      </div>

      <div class="tools-grid">
        <section class="tool-card" id="rip-card">
          <span class="section-kicker">04 / Capture</span><h2>Rip the active audio</h2>
          <p class="muted">Record the audio currently playing through the media element as a downloadable WebM file.</p>
          <div class="tool-actions"><button class="primary-button" id="start-recording" type="button" disabled>Start recording</button><button class="secondary-button" id="stop-recording" type="button" disabled>Stop and save</button></div>
          <div class="result-box" id="recording-result"><span class="empty-state">The recording follows playback. Start it before pressing play.</span></div>
        </section>
        <section class="tool-card ai-card" id="ai-card">
          <span class="section-kicker">05 / Understand</span><h2>Local AI extraction</h2>
          <p class="muted">Optional browser-local Whisper transcription and JSON extraction. Model downloads can be large and need WebGPU.</p>
          <div class="tool-actions"><button class="primary-button" id="boot-ai" type="button">Boot local engines</button><button class="secondary-button" id="transcribe" type="button" disabled>Transcribe media</button></div>
          <div class="progress-line"><span id="ai-status">Not loaded</span><span id="ai-progress"></span></div>
          <div class="result-box transcript-box" id="transcript-result"><span class="empty-state">No transcript yet.</span></div>
        </section>
      </div>
    </section>

    <footer><span>ANNE SULLIVAN / MVP 01</span><a href="https://github.com/EthanThatOneKid/annesullivan" target="_blank" rel="noreferrer">View the source ↗</a></footer>
  </main>
`;

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const fileInput = $('#file-input') as HTMLInputElement;
const dropZone = $('#drop-zone') as HTMLDivElement;
const mediaPanel = $('#media-panel') as HTMLDivElement;
const mediaPreview = $('#media-preview') as HTMLVideoElement;
const audioPreview = $('#audio-preview') as HTMLAudioElement;
const fileName = $('#file-name') as HTMLHeadingElement;
const mediaStats = $('#media-stats') as HTMLDivElement;
const capabilities = $('#capabilities') as HTMLDivElement;
const captionsResult = $('#captions-result') as HTMLDivElement;
const trackList = $('#track-list') as HTMLDivElement;
const recordingResult = $('#recording-result') as HTMLDivElement;
const transcriptResult = $('#transcript-result') as HTMLDivElement;
const aiStatus = $('#ai-status') as HTMLSpanElement;
const aiProgress = $('#ai-progress') as HTMLSpanElement;
const extractCaptionsButton = $('#extract-captions') as HTMLButtonElement;
const downloadCaptionsButton = $('#download-captions') as HTMLButtonElement;
const startRecordingButton = $('#start-recording') as HTMLButtonElement;
const stopRecordingButton = $('#stop-recording') as HTMLButtonElement;
const bootAiButton = $('#boot-ai') as HTMLButtonElement;
const transcribeButton = $('#transcribe') as HTMLButtonElement;

const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '—';
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remaining}`;
};
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character] ?? character);
const setStatus = (message: string) => { aiStatus.textContent = message; };

function renderCapabilities() {
  const checks = [
    ['WebGPU', 'gpu' in navigator, 'Runs local AI models on a compatible GPU.'],
    ['Web Workers', typeof Worker !== 'undefined', 'Keeps expensive work off the interface thread.'],
    ['Speech Recognition', 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window, 'Native browser STT fallback; support varies.'],
    ['Media capture', 'MediaRecorder' in window && ('captureStream' in HTMLMediaElement.prototype || 'mozCaptureStream' in HTMLMediaElement.prototype), 'Records active media audio as WebM.'],
  ] as const;
  capabilities.innerHTML = checks.map(([label, supported, description]) => `<div class="capability"><span class="capability-icon ${supported ? 'yes' : 'no'}">${supported ? '✓' : '—'}</span><div><strong>${label}</strong><small>${description}</small></div></div>`).join('');
}

function revokeMedia() {
  if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  mediaUrl = null;
}

function getCaptionCues(): CaptionCue[] {
  if (!mediaElement) return [];
  return Array.from(mediaElement.textTracks).flatMap((track) => {
    track.mode = 'hidden';
    return track.cues ? Array.from(track.cues).map((cue) => ({ startTime: cue.startTime, endTime: cue.endTime, text: cue.text })) : [];
  });
}

function renderCaptions(cues: CaptionCue[]) {
  captionsResult.innerHTML = cues.length ? `<div class="cue-table">${cues.map((cue) => `<div class="cue-row"><time>${formatTime(cue.startTime)}</time><span>${escapeHtml(cue.text).replace(/\n/g, '<br>')}</span></div>`).join('')}</div>` : '<span class="empty-state">No loaded text-track cues found.</span>';
  downloadCaptionsButton.disabled = cues.length === 0;
}

function renderTracks() {
  const tracks = mediaElement && 'audioTracks' in mediaElement && mediaElement.audioTracks ? Array.from(mediaElement.audioTracks).map((track, index) => ({ index, id: track.id, kind: track.kind, label: track.label, language: track.language, enabled: track.enabled })) : [];
  lastInspection = lastInspection ? { ...lastInspection, audioTracks: tracks } : lastInspection;
  if (!tracks.length) {
    trackList.innerHTML = '<span class="empty-state">This browser does not expose embedded audio-track metadata for this file.</span>';
    const note = $('#audio-track-note');
    if (note) note.textContent = 'Safari has the broadest HTMLMediaElement.audioTracks support. Chromium may hide this metadata.';
    return;
  }
  trackList.innerHTML = tracks.map((track) => `<label class="track-row"><input type="radio" name="audio-track" value="${track.index}" ${track.enabled ? 'checked' : ''}><span><strong>${escapeHtml(track.label || `Track ${track.index + 1}`)}</strong><small>${escapeHtml(track.kind || 'main')} ${track.language ? `· ${escapeHtml(track.language)}` : ''}</small></span></label>`).join('');
  trackList.querySelectorAll<HTMLInputElement>('input[name="audio-track"]').forEach((input) => input.addEventListener('change', () => {
    if (!mediaElement?.audioTracks) return;
    Array.from(mediaElement.audioTracks).forEach((track, index) => { track.enabled = index === Number(input.value); });
    renderTracks();
  }));
}

async function inspectFile(file: File) {
  if (!file.type.startsWith('audio/') && !file.type.startsWith('video/')) return;
  selectedFile = file;
  revokeMedia();
  mediaUrl = URL.createObjectURL(file);
  const isVideo = file.type.startsWith('video/');
  mediaElement = isVideo ? mediaPreview : audioPreview;
  mediaPreview.classList.toggle('hidden', !isVideo);
  audioPreview.classList.toggle('hidden', isVideo);
  mediaPreview.removeAttribute('src');
  audioPreview.removeAttribute('src');
  mediaElement.src = mediaUrl;
  mediaElement.load();
  mediaPanel.classList.remove('hidden');
  fileName.textContent = file.name;
  extractCaptionsButton.disabled = false;
  startRecordingButton.disabled = !('captureStream' in mediaElement || 'mozCaptureStream' in mediaElement);
  captionsResult.innerHTML = '<span class="empty-state">Media loaded. Extract cues to inspect captions.</span>';
  recordingResult.innerHTML = '<span class="empty-state">The recording follows playback. Start it before pressing play.</span>';
  transcriptResult.innerHTML = '<span class="empty-state">Ready to transcribe when local AI is loaded.</span>';
  mediaElement.onloadedmetadata = () => {
    const inspection: MediaInspection = { name: file.name, type: file.type, size: file.size, duration: mediaElement?.duration ?? null, width: isVideo ? mediaPreview.videoWidth : null, height: isVideo ? mediaPreview.videoHeight : null, captions: [], audioTracks: [], canCaptureStream: 'captureStream' in mediaElement || 'mozCaptureStream' in mediaElement };
    lastInspection = inspection;
    mediaStats.innerHTML = [['Type', file.type.split('/')[1]?.toUpperCase() ?? 'MEDIA'], ['Size', formatBytes(file.size)], ['Length', formatTime(inspection.duration ?? NaN)], ['Frame', isVideo ? `${inspection.width} × ${inspection.height}` : 'Audio only']].map(([label, value]) => `<div class="stat"><small>${label}</small><strong>${value}</strong></div>`).join('');
    renderTracks();
  };
}

function toVtt(cues: CaptionCue[]) {
  const stamp = (seconds: number) => {
    const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const rest = (seconds % 60).toFixed(3).padStart(6, '0');
    return `${hours}:${minutes}:${rest}`;
  };
  return `WEBVTT\n\n${cues.map((cue, index) => `${index + 1}\n${stamp(cue.startTime)} --> ${stamp(cue.endTime)}\n${cue.text}`).join('\n\n')}\n`;
}

$('#choose-button')?.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; if (file) void inspectFile(file); });
dropZone.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.classList.add('dragging'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
dropZone.addEventListener('drop', (event) => { event.preventDefault(); dropZone.classList.remove('dragging'); const file = event.dataTransfer?.files[0]; if (file) void inspectFile(file); });
dropZone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') fileInput.click(); });
$('#clear-button')?.addEventListener('click', () => { selectedFile = null; mediaElement?.pause(); mediaElement = null; revokeMedia(); mediaPanel.classList.add('hidden'); fileInput.value = ''; });
extractCaptionsButton.addEventListener('click', () => { const cues = getCaptionCues(); if (lastInspection) lastInspection.captions = cues; renderCaptions(cues); });
downloadCaptionsButton.addEventListener('click', () => { if (!lastInspection?.captions.length) return; const url = URL.createObjectURL(new Blob([toVtt(lastInspection.captions)], { type: 'text/vtt' })); const link = document.createElement('a'); link.href = url; link.download = `${selectedFile?.name.replace(/\.[^.]+$/, '') ?? 'captions'}.vtt`; link.click(); URL.revokeObjectURL(url); });
startRecordingButton.addEventListener('click', () => { if (!mediaElement || !selectedFile) return; const capture = 'captureStream' in mediaElement ? mediaElement.captureStream() : mediaElement.mozCaptureStream(); const audioTracks = capture.getAudioTracks(); if (!audioTracks.length) { recordingResult.innerHTML = '<span class="error-state">No audio track is available to capture.</span>'; return; } recordedChunks = []; activeRecorder = new MediaRecorder(new MediaStream(audioTracks), { mimeType: 'audio/webm' }); activeRecorder.ondataavailable = (event) => { if (event.data.size) recordedChunks.push(event.data); }; activeRecorder.onstart = () => { startRecordingButton.disabled = true; stopRecordingButton.disabled = false; recordingResult.innerHTML = '<span class="recording-state"><i></i> Recording active. Press stop when playback is complete.</span>'; }; activeRecorder.start(); });
stopRecordingButton.addEventListener('click', () => { if (!activeRecorder) return; activeRecorder.onstop = () => { const blob = new Blob(recordedChunks, { type: 'audio/webm' }); const url = URL.createObjectURL(blob); recordingResult.innerHTML = `<a class="download-link" href="${url}" download="${selectedFile?.name.replace(/\.[^.]+$/, '') ?? 'extracted-audio'}.webm">Download extracted audio · ${formatBytes(blob.size)} ↗</a>`; startRecordingButton.disabled = false; stopRecordingButton.disabled = true; }; activeRecorder.stop(); activeRecorder = null; });

bootAiButton.addEventListener('click', async () => {
  bootAiButton.disabled = true;
  setStatus('Loading Whisper…');
  whisperWorker.postMessage({ type: 'INIT' });
  whisperWorker.onmessage = async (event: MessageEvent<{ status: string; message?: string; model?: string; text?: string; chunks?: Array<{ text: string; timestamp: [number, number] } }>) => {
    if (event.data.status === 'loading') setStatus(event.data.message ?? 'Loading model…');
    if (event.data.status === 'ready') {
      setStatus(`Whisper ready · ${event.data.model}`);
      transcribeButton.disabled = false;
      if ('gpu' in navigator) {
        aiProgress.textContent = ' · WebGPU';
      } else {
        aiProgress.textContent = ' · WASM fallback recommended';
      }
    }
    if (event.data.status === 'transcribing') setStatus('Transcribing locally…');
    if (event.data.status === 'done') {
      const text = event.data.text ?? '';
      transcriptResult.innerHTML = `<p>${escapeHtml(text)}</p>`;
      setStatus('Transcription complete');
      transcribeButton.disabled = false;
    }
    if (event.data.status === 'error') { setStatus(`Error: ${event.data.message ?? 'Unknown worker error'}`); bootAiButton.disabled = false; transcribeButton.disabled = true; }
  };
  try {
    llmEngine = await CreateWebWorkerMLCEngine(llmWorker, 'Phi-3.5-mini-instruct-q4f16_1-MLC', { initProgressCallback: (progress) => { aiProgress.textContent = ` · ${Math.round(progress.progress * 100)}%`; } });
    void llmEngine;
    aiProgress.textContent = ' · LLM available';
  } catch (error) {
    aiProgress.textContent = ` · LLM unavailable (${error instanceof Error ? error.message : 'unsupported model'})`;
  }
});
transcribeButton.addEventListener('click', async () => { if (!selectedFile) return; transcribeButton.disabled = true; const context = new AudioContext({ sampleRate: 16000 }); try { const buffer = await context.decodeAudioData(await selectedFile.arrayBuffer()); const channel = buffer.getChannelData(0); const copy = new Float32Array(channel); whisperWorker.postMessage({ type: 'TRANSCRIBE', audioData: copy, sampleRate: buffer.sampleRate }, [copy.buffer]); } catch (error) { setStatus(`Audio decode failed: ${error instanceof Error ? error.message : String(error)}`); transcribeButton.disabled = false; } finally { await context.close(); } });

renderCapabilities();
