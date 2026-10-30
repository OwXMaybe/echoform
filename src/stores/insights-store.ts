import { pickOnsets } from "@/core/dsp/onset";
import type {
  ChannelSelection,
  NoiseResult,
  NoveltyResult,
  OnsetEvent,
  PitchTrack,
  TempoResult,
} from "@/types/analysis";
import { analysisClient, audioStore, scopeRange, track } from "./audio-store";
import { createStore } from "./create-store";
import { selectionStore } from "./selection-store";
import { settingsStore } from "./settings-store";

export interface InsightsState {
  novelty: NoveltyResult | null;
  sensitivity: number;
  onsets: OnsetEvent[];
  threshold: Float32Array | null;
  tempo: TempoResult | null;
  pitch: PitchTrack | null;
  noise: (NoiseResult & { zeroCrossingRate: number | null }) | null;
  /** The channel the curves were computed from. */
  channel: ChannelSelection | null;
}

const EMPTY = {
  novelty: null,
  onsets: [],
  threshold: null,
  tempo: null,
  pitch: null,
  noise: null,
  channel: null,
} satisfies Partial<InsightsState>;

export const insightsStore = createStore<InsightsState>({ ...EMPTY, sensitivity: 0.5 });

let active = false;
let wholeKey = "";
let scopeKey = "";
let scopeTimer: ReturnType<typeof setTimeout> | undefined;

/** Everything here is costly, so it runs only while a page that shows it is open. */
function runWhole(): void {
  const recording = audioStore.get().recording;
  if (!active || !recording) return;
  const { channel } = settingsStore.get();
  const key = `${recording.id}|${channel}`;
  if (key === wholeKey) return;
  wholeKey = key;
  scopeKey = "";
  const { id } = recording;
  insightsStore.set({ channel });
  void track("novelty", (onProgress) =>
    analysisClient().run("novelty", { channel }, onProgress),
  ).then((novelty) => {
    if (!novelty || audioStore.get().recording?.id !== id) return;
    const { events, threshold } = pickOnsets(novelty, insightsStore.get().sensitivity);
    insightsStore.set({ novelty, onsets: events, threshold });
    runScoped();
  });
  void track("pitch", (onProgress) => analysisClient().run("pitch", { channel }, onProgress)).then(
    (pitch) => {
      if (pitch && audioStore.get().recording?.id === id) insightsStore.set({ pitch });
    },
  );
}

function runScoped(): void {
  const recording = audioStore.get().recording;
  if (!active || !recording || !insightsStore.get().novelty) return;
  const { channel } = settingsStore.get();
  const range = scopeRange();
  const key = `${recording.id}|${channel}|${range.start}|${range.end}`;
  if (key === scopeKey) return;
  scopeKey = key;
  const { id } = recording;
  const rate = recording.decoded.sampleRate;
  void track("tempo", (onProgress) =>
    analysisClient().run(
      "tempo",
      { startSeconds: range.start / rate, endSeconds: range.end / rate },
      onProgress,
    ),
  ).then((tempo) => {
    if (tempo && audioStore.get().recording?.id === id) insightsStore.set({ tempo });
  });
  void track("noise", (onProgress) =>
    analysisClient().run("noise", { range, channel }, onProgress),
  ).then((noise) => {
    if (noise && audioStore.get().recording?.id === id) insightsStore.set({ noise });
  });
}

function scheduleScoped(): void {
  clearTimeout(scopeTimer);
  scopeTimer = setTimeout(runScoped, 200);
}

export function setInsightsActive(value: boolean): void {
  active = value;
  if (!value) return;
  runWhole();
  // The curves may have finished while no page was open to start these.
  runScoped();
}

export function setSensitivity(sensitivity: number): void {
  const { novelty } = insightsStore.get();
  if (!novelty) {
    insightsStore.set({ sensitivity });
    return;
  }
  const { events, threshold } = pickOnsets(novelty, sensitivity);
  insightsStore.set({ sensitivity, onsets: events, threshold });
}

selectionStore.subscribe(scheduleScoped);
settingsStore.subscribe(() => {
  runWhole();
  scheduleScoped();
});

let recordingId = audioStore.get().recording?.id;
audioStore.subscribe(() => {
  const id = audioStore.get().recording?.id;
  if (id === recordingId) return;
  recordingId = id;
  wholeKey = "";
  scopeKey = "";
  clearTimeout(scopeTimer);
  insightsStore.set(EMPTY);
  runWhole();
});
