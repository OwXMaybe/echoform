import { AudioImportError, importAudioFile } from "@/core/audio/decoder";
import type {
  ComparisonNormalisation,
  ComparisonResult,
  OffsetEstimate,
} from "@/types/analysis";
import { analysisClient, audioStore, cancelJob, track } from "./audio-store";
import { createStore } from "./create-store";
import { selectionStore } from "./selection-store";
import { settingsStore } from "./settings-store";

export type AlignmentMethod = "start" | "end" | "manual" | "estimated";

export interface ReferenceInfo {
  name: string;
  duration: number;
  sampleRate: number;
  channelCount: number;
  warnings: string[];
}

export interface ComparisonState {
  reference: ReferenceInfo | null;
  importStage: string | null;
  importError: string | null;
  alignment: AlignmentMethod;
  manualOffset: number;
  estimate: OffsetEstimate | null;
  normalisation: ComparisonNormalisation;
  result: ComparisonResult | null;
  /** The last run found nothing to compare under the current alignment. */
  noOverlap: boolean;
}

export const comparisonStore = createStore<ComparisonState>({
  reference: null,
  importStage: null,
  importError: null,
  alignment: "start",
  manualOffset: 0,
  estimate: null,
  normalisation: "none",
  result: null,
  noOverlap: false,
});

let runTimer: ReturnType<typeof setTimeout> | undefined;
let runKey = "";
let importToken = 0;

/** B's start on A's timeline under the chosen alignment. */
export function alignmentOffset(state: ComparisonState, durationA: number): number {
  switch (state.alignment) {
    case "start":
      return 0;
    case "end":
      return durationA - (state.reference?.duration ?? 0);
    case "manual":
      return state.manualOffset;
    case "estimated":
      return state.estimate?.offsetSeconds ?? 0;
  }
}

function runComparison(): void {
  const state = comparisonStore.get();
  const recording = audioStore.get().recording;
  if (!state.reference || !recording) return;
  const { time } = selectionStore.get();
  const { fftSize, windowFunction, rolloffPercent } = settingsStore.get();
  const request = {
    offsetSeconds: alignmentOffset(state, recording.decoded.duration),
    selection: time,
    normalisation: state.normalisation,
    fftSize,
    windowFunction,
    rolloffPercent,
  };
  const key = JSON.stringify(request);
  if (key === runKey) return;
  runKey = key;
  void track("compare", (onProgress) => analysisClient().run("compare", request, onProgress)).then(
    (result) => {
      if (audioStore.get().recording?.id !== recording.id) return;
      // track() gives null for a superseded job too, and only a finished run may report no overlap.
      if (result) comparisonStore.set({ result, noOverlap: false });
      else if (audioStore.get().status.compare === "done") {
        comparisonStore.set({ result: null, noOverlap: true });
      }
    },
  );
}

function scheduleComparison(): void {
  clearTimeout(runTimer);
  runTimer = setTimeout(runComparison, 120);
}

export function setAlignment(alignment: AlignmentMethod): void {
  comparisonStore.set({ alignment });
  scheduleComparison();
}

export function setManualOffset(manualOffset: number): void {
  comparisonStore.set({ manualOffset });
  scheduleComparison();
}

export function setNormalisation(normalisation: ComparisonNormalisation): void {
  comparisonStore.set({ normalisation });
  scheduleComparison();
}

/** Runs only when asked: an estimate is the user's choice of alignment, never a silent default. */
export function estimateAlignment(): void {
  const recording = audioStore.get().recording;
  if (!recording || !comparisonStore.get().reference) return;
  void track("offset", (onProgress) => analysisClient().run("offset", {}, onProgress)).then(
    (estimate) => {
      if (!estimate || audioStore.get().recording?.id !== recording.id) return;
      comparisonStore.set({ estimate, alignment: "estimated" });
      scheduleComparison();
    },
  );
}

export async function loadReference(file: File): Promise<void> {
  const token = ++importToken;
  comparisonStore.set({ importStage: "Validating", importError: null });
  try {
    const { recording, buffer } = await importAudioFile(file, (stage) => {
      if (token === importToken) comparisonStore.set({ importStage: stage });
    });
    if (token !== importToken) return;
    analysisClient().loadReference(buffer);
    const { duration, sampleRate, channelCount } = recording.decoded;
    runKey = "";
    comparisonStore.set({
      importStage: null,
      reference: {
        name: recording.original.name,
        duration,
        sampleRate,
        channelCount,
        warnings: recording.warnings,
      },
      alignment: "start",
      estimate: null,
      result: null,
      noOverlap: false,
    });
    runComparison();
  } catch (error) {
    if (token !== importToken) return;
    comparisonStore.set({
      importStage: null,
      importError:
        error instanceof AudioImportError
          ? error.message
          : `"${file.name}" could not be opened. The browser may have run out of memory.`,
    });
  }
}

export function clearReference(): void {
  importToken++;
  clearTimeout(runTimer);
  runKey = "";
  cancelJob("compare");
  cancelJob("offset");
  analysisClient().clearReference();
  comparisonStore.set({
    reference: null,
    importStage: null,
    importError: null,
    alignment: "start",
    estimate: null,
    result: null,
    noOverlap: false,
  });
}

selectionStore.subscribe(() => {
  if (comparisonStore.get().reference) scheduleComparison();
});
settingsStore.subscribe(() => {
  if (comparisonStore.get().reference) scheduleComparison();
});

let recordingId = audioStore.get().recording?.id;
audioStore.subscribe(() => {
  const id = audioStore.get().recording?.id;
  if (id === recordingId) return;
  recordingId = id;
  runKey = "";
  // An estimate describes the previous recording. Closing it also clears the worker's copy of B.
  if (id === undefined) clearReference();
  else {
    comparisonStore.set({ result: null, estimate: null, alignment: "start", noOverlap: false });
    scheduleComparison();
  }
});
