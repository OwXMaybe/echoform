import { AnalysisClient, JobCancelled } from "@/core/analysis/analysis-client";
import { AudioImportError, importAudioFile } from "@/core/audio/decoder";
import type {
  ChannelAmplitude,
  ChannelSelection,
  ChannelSignal,
  RecordingScan,
  SampleRange,
  SilenceResult,
  SpectrogramResult,
  SpectrumResult,
  StereoResult,
  WaveformPyramid,
} from "@/types/analysis";
import type { AudioRecording } from "@/types/audio";
import type { JobKind } from "@/workers/protocol";
import { createStore } from "./create-store";
import { playback, playbackStore } from "./playback-store";
import { resetSelection, selectionStore, type TimeRange } from "./selection-store";
import { settingsStore } from "./settings-store";

export type JobStatus = "idle" | "running" | "done" | "cancelled" | "error";

export interface AudioState {
  recording: AudioRecording | null;
  importStage: string | null;
  importError: string | null;
  waveform: WaveformPyramid[] | null;
  amplitude: ChannelAmplitude[] | null;
  spectrum: SpectrumResult | null;
  spectrogram: SpectrogramResult | null;
  /** The channel the current spectrogram actually shows. */
  spectrogramChannel: ChannelSelection | null;
  /** Finer spectrogram of the zoomed region, when the overview is memory-capped. */
  spectrogramDetail: SpectrogramResult | null;
  signal: ChannelSignal[] | null;
  scan: RecordingScan | null;
  silence: SilenceResult | null;
  /** null for anything but a two-channel recording. */
  stereo: StereoResult | null;
  status: Record<JobKind, JobStatus>;
  progress: Record<JobKind, number>;
}

const IDLE_STATUS: Record<JobKind, JobStatus> = {
  waveform: "idle",
  amplitude: "idle",
  spectrum: "idle",
  spectrogram: "idle",
  spectrogramDetail: "idle",
  signal: "idle",
  scan: "idle",
  silence: "idle",
  stereo: "idle",
  filter: "idle",
  processedSpectrum: "idle",
  offset: "idle",
  compare: "idle",
  novelty: "idle",
  tempo: "idle",
  pitch: "idle",
  noise: "idle",
};
const ZERO_PROGRESS: Record<JobKind, number> = {
  waveform: 0,
  amplitude: 0,
  spectrum: 0,
  spectrogram: 0,
  spectrogramDetail: 0,
  signal: 0,
  scan: 0,
  silence: 0,
  stereo: 0,
  filter: 0,
  processedSpectrum: 0,
  offset: 0,
  compare: 0,
  novelty: 0,
  tempo: 0,
  pitch: 0,
  noise: 0,
};

const EMPTY_RESULTS = {
  waveform: null,
  amplitude: null,
  spectrum: null,
  spectrogram: null,
  spectrogramChannel: null,
  spectrogramDetail: null,
  signal: null,
  scan: null,
  silence: null,
  stereo: null,
  status: IDLE_STATUS,
  progress: ZERO_PROGRESS,
} satisfies Partial<AudioState>;

export const audioStore = createStore<AudioState>({
  recording: null,
  importStage: null,
  importError: null,
  ...EMPTY_RESULTS,
});

// PCM stays out of every store: the AudioBuffer lives here and is read directly by renderers.
let currentBuffer: AudioBuffer | null = null;
let client: AnalysisClient | null = null;

export const getAudioBuffer = (): AudioBuffer | null => currentBuffer;

export function analysisClient(): AnalysisClient {
  if (!client) {
    client = new AnalysisClient();
    client.onWorkerFailure = () => {
      const { status } = audioStore.get();
      const failed = Object.fromEntries(
        Object.entries(status).map(([k, v]) => [k, v === "running" ? "error" : v]),
      ) as Record<JobKind, JobStatus>;
      audioStore.set({ status: failed });
    };
  }
  return client;
}

function setJob(kind: JobKind, status: JobStatus, progress?: number): void {
  const state = audioStore.get();
  audioStore.set({
    status: { ...state.status, [kind]: status },
    progress: progress === undefined ? state.progress : { ...state.progress, [kind]: progress },
  });
}

// Messages from a superseded or cancelled job can still be queued; its token no longer matches.
const jobTokens: Record<JobKind, number> = { ...ZERO_PROGRESS };

export async function track<T>(kind: JobKind, job: (onProgress: (v: number) => void) => Promise<T>) {
  const token = ++jobTokens[kind];
  const isCurrent = () => jobTokens[kind] === token;
  setJob(kind, "running", 0);
  try {
    const result = await job((value) => {
      if (isCurrent()) setJob(kind, "running", value);
    });
    if (!isCurrent()) return null;
    setJob(kind, "done", 1);
    return result;
  } catch (error) {
    if (isCurrent() && !(error instanceof JobCancelled)) setJob(kind, "error");
    return null;
  }
}

export function scopeRange(): SampleRange {
  const buffer = currentBuffer!;
  const { time } = selectionStore.get();
  if (!time) return { start: 0, end: buffer.length };
  return {
    start: Math.round(time.start * buffer.sampleRate),
    end: Math.min(buffer.length, Math.round(time.end * buffer.sampleRate)),
  };
}

let measureKey = "";
let spectrogramKey = "";
let silenceKey = "";
let measureTimer: ReturnType<typeof setTimeout> | undefined;
let spectrogramTimer: ReturnType<typeof setTimeout> | undefined;
let silenceTimer: ReturnType<typeof setTimeout> | undefined;
let detailTimer: ReturnType<typeof setTimeout> | undefined;

function runMeasurements(): void {
  const recording = audioStore.get().recording;
  if (!recording || !currentBuffer) return;
  const range = scopeRange();
  const { fftSize, windowFunction, channel } = settingsStore.get();
  const key = [range.start, range.end, fftSize, windowFunction, channel].join();
  if (key === measureKey) return;
  measureKey = key;
  const id = recording.id;
  void track("amplitude", () =>
    analysisClient().run("amplitude", { range, labels: recording.decoded.channelLabels }),
  ).then((amplitude) => {
    if (amplitude && audioStore.get().recording?.id === id) audioStore.set({ amplitude });
  });
  void track("spectrum", (onProgress) =>
    analysisClient().run("spectrum", { range, channel, fftSize, windowFunction }, onProgress),
  ).then((spectrum) => {
    if (spectrum && audioStore.get().recording?.id === id) audioStore.set({ spectrum });
  });
  void track("signal", (onProgress) =>
    analysisClient().run("signal", { range, labels: recording.decoded.channelLabels }, onProgress),
  ).then((signal) => {
    if (signal && audioStore.get().recording?.id === id) audioStore.set({ signal });
  });
  if (recording.decoded.channelCount === 2) {
    void track("stereo", (onProgress) => analysisClient().run("stereo", { range }, onProgress)).then(
      (stereo) => {
        if (stereo && audioStore.get().recording?.id === id) audioStore.set({ stereo });
      },
    );
  }
}

export function runSpectrogram(force = false): void {
  const recording = audioStore.get().recording;
  if (!recording) return;
  const { fftSize, hopDivisor, windowFunction, channel } = settingsStore.get();
  const hopSize = fftSize / hopDivisor;
  const key = [fftSize, hopSize, windowFunction, channel].join();
  if (key === spectrogramKey && !force) return;
  spectrogramKey = key;
  const id = recording.id;
  void track("spectrogram", (onProgress) =>
    analysisClient().run(
      "spectrogram",
      { channel, fftSize, hopSize, windowFunction },
      onProgress,
    ),
  ).then((spectrogram) => {
    if (spectrogram && audioStore.get().recording?.id === id) {
      audioStore.set({ spectrogram, spectrogramChannel: channel, spectrogramDetail: null });
      scheduleDetail();
    }
  });
}

function runSilence(): void {
  const recording = audioStore.get().recording;
  if (!recording) return;
  const { silenceThresholdDb, silenceMinSeconds, silencePaddingSeconds } = settingsStore.get();
  const key = [silenceThresholdDb, silenceMinSeconds, silencePaddingSeconds].join();
  if (key === silenceKey) return;
  silenceKey = key;
  const id = recording.id;
  void track("silence", (onProgress) =>
    analysisClient().run(
      "silence",
      {
        thresholdDb: silenceThresholdDb,
        minDurationSeconds: silenceMinSeconds,
        paddingSeconds: silencePaddingSeconds,
      },
      onProgress,
    ),
  ).then((silence) => {
    if (silence && audioStore.get().recording?.id === id) audioStore.set({ silence });
  });
}

/** The best data for a view: the detail spectrogram if it covers the view, else the overview. */
export function visibleSpectrogram(view: TimeRange): SpectrogramResult | null {
  const { spectrogram, spectrogramDetail: detail } = audioStore.get();
  if (!detail) return spectrogram;
  const detailEnd =
    detail.startSeconds + (detail.columns * detail.hopSize * detail.framesPerColumn) / detail.sampleRate;
  return detail.startSeconds <= view.start && detailEnd >= view.end ? detail : spectrogram;
}

function runDetail(): void {
  const { recording, spectrogram: overview, spectrogramChannel } = audioStore.get();
  const { view, duration } = selectionStore.get();
  if (!recording || !overview || spectrogramChannel === null) return;
  // Only a memory-capped overview has detail to recover.
  if (overview.framesPerColumn === 1 || view.end - view.start >= duration * 0.9) return;
  if (visibleSpectrogram(view) !== overview) return;
  const span = view.end - view.start;
  const rate = overview.sampleRate;
  const range = {
    start: Math.max(0, Math.floor((view.start - span / 4) * rate)),
    end: Math.min(recording.decoded.frameCount, Math.ceil((view.end + span / 4) * rate)),
  };
  const { fftSize, hopSize, windowFunction } = overview;
  const id = recording.id;
  void track("spectrogramDetail", (onProgress) =>
    analysisClient().run(
      "spectrogramDetail",
      { channel: spectrogramChannel, fftSize, hopSize, windowFunction, range },
      onProgress,
    ),
  ).then((spectrogramDetail) => {
    if (spectrogramDetail && audioStore.get().recording?.id === id) {
      audioStore.set({ spectrogramDetail });
    }
  });
}

function scheduleDetail(): void {
  clearTimeout(detailTimer);
  detailTimer = setTimeout(runDetail, 250);
}

/** Stops a job and makes sure nothing it still has queued is applied. */
export function cancelJob(kind: JobKind): void {
  jobTokens[kind]++;
  analysisClient().cancel(kind);
  setJob(kind, "cancelled");
}

export function cancelSpectrogram(): void {
  cancelJob("spectrogram");
  spectrogramKey = "";
}

function scheduleMeasurements(): void {
  clearTimeout(measureTimer);
  measureTimer = setTimeout(runMeasurements, 90);
}

function scheduleSpectrogram(): void {
  clearTimeout(spectrogramTimer);
  spectrogramTimer = setTimeout(() => runSpectrogram(), 200);
}

function scheduleSilence(): void {
  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(runSilence, 200);
}

let lastView = selectionStore.get().view;
selectionStore.subscribe(() => {
  scheduleMeasurements();
  const { view } = selectionStore.get();
  if (view !== lastView) scheduleDetail();
  lastView = view;
});
settingsStore.subscribe(() => {
  scheduleMeasurements();
  scheduleSpectrogram();
  scheduleSilence();
});

let importToken = 0;

/** Imports a file. On failure the current recording and its results are left untouched. */
export async function openFile(file: File): Promise<boolean> {
  const token = ++importToken;
  audioStore.set({ importStage: "Validating", importError: null });
  try {
    const { recording, buffer } = await importAudioFile(file, (stage) => {
      if (token === importToken) audioStore.set({ importStage: stage });
    });
    if (token !== importToken) return false;

    playback.load(buffer);
    playbackStore.set({ isPlaying: false, loop: false });
    playback.setLoop(null);
    currentBuffer = buffer;
    measureKey = "";
    spectrogramKey = "";
    silenceKey = "";
    // Before anything is told: subscribers may start jobs that must see this audio.
    const worker = analysisClient();
    worker.load(buffer);
    audioStore.set({
      recording,
      importStage: null,
      ...EMPTY_RESULTS,
    });
    settingsStore.set({
      channel: buffer.numberOfChannels === 1 ? 0 : "mix",
      viewMinHz: null,
      viewMaxHz: null,
      spectrumSource: "scope",
    });
    resetSelection(buffer.duration);

    const id = recording.id;
    void track("waveform", (onProgress) => worker.run("waveform", {}, onProgress)).then(
      (waveform) => {
        if (waveform && audioStore.get().recording?.id === id) audioStore.set({ waveform });
      },
    );
    clearTimeout(measureTimer);
    clearTimeout(spectrogramTimer);
    clearTimeout(silenceTimer);
    void track("scan", (onProgress) =>
      worker.run("scan", { labels: recording.decoded.channelLabels }, onProgress),
    ).then((scan) => {
      if (scan && audioStore.get().recording?.id === id) audioStore.set({ scan });
    });
    runMeasurements();
    runSpectrogram();
    runSilence();
    return true;
  } catch (error) {
    if (token !== importToken) return false;
    audioStore.set({
      importStage: null,
      importError:
        error instanceof AudioImportError
          ? error.message
          : `"${file.name}" could not be opened. The browser may have run out of memory.`,
    });
    return false;
  }
}

/** Releases the PCM, the worker's copy and the audio output. */
export function closeRecording(): void {
  importToken++;
  clearTimeout(measureTimer);
  clearTimeout(spectrogramTimer);
  clearTimeout(silenceTimer);
  clearTimeout(detailTimer);
  client?.clear();
  void playback.dispose();
  playbackStore.set({ isPlaying: false, loop: false });
  playback.setLoop(null);
  currentBuffer = null;
  measureKey = "";
  spectrogramKey = "";
  silenceKey = "";
  audioStore.set({
    recording: null,
    importStage: null,
    ...EMPTY_RESULTS,
  });
  resetSelection(0);
}
