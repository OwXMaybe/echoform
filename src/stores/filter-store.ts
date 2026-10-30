import {
  maxDesignFrequency,
  type FilterConfiguration,
  type FilterType,
} from "@/core/dsp/filters";
import type { SpectrumResult } from "@/types/analysis";
import {
  analysisClient,
  audioStore,
  cancelJob,
  getAudioBuffer,
  scopeRange,
  track,
} from "./audio-store";
import { createStore } from "./create-store";
import { playback } from "./playback-store";
import { selectionStore } from "./selection-store";
import { settingsStore } from "./settings-store";

export type Monitor = "original" | "processed";

export const MAX_FILTERS = 8;

const DEFAULTS: Record<FilterType, Pick<FilterConfiguration, "frequency" | "q" | "gainDb">> = {
  lowpass: { frequency: 8000, q: Math.SQRT1_2, gainDb: 0 },
  highpass: { frequency: 80, q: Math.SQRT1_2, gainDb: 0 },
  bandpass: { frequency: 1000, q: 1, gainDb: 0 },
  notch: { frequency: 1000, q: 10, gainDb: 0 },
  peaking: { frequency: 1000, q: 1, gainDb: 6 },
  lowshelf: { frequency: 200, q: Math.SQRT1_2, gainDb: 6 },
  highshelf: { frequency: 6000, q: Math.SQRT1_2, gainDb: 6 },
};

export interface RenderInfo {
  /** The filter settings this render reflects. */
  key: string;
  peakDb: number | null;
  rmsDb: number | null;
  overRangeSamples: number;
}

export interface FilterState {
  filters: FilterConfiguration[];
  monitor: Monitor;
  rendered: RenderInfo | null;
  processedSpectrum: SpectrumResult | null;
}

export const filterStore = createStore<FilterState>({
  filters: [],
  monitor: "original",
  rendered: null,
  processedSpectrum: null,
});

// Like the original, processed PCM stays out of every store.
let processedBuffer: AudioBuffer | null = null;
let nextId = 1;
let renderTimer: ReturnType<typeof setTimeout> | undefined;
let spectrumTimer: ReturnType<typeof setTimeout> | undefined;

/** Identifies what a render would contain: disabled filters and ids do not affect the audio. */
export function chainKey(filters: FilterConfiguration[]): string {
  return JSON.stringify(
    filters
      .filter((f) => f.enabled)
      .map(({ filterType, frequency, q, gainDb, order }) => [
        filterType,
        frequency,
        q,
        gainDb,
        order,
      ]),
  );
}

function listenTo(monitor: Monitor): void {
  const buffer = monitor === "processed" ? processedBuffer : getAudioBuffer();
  if (buffer) playback.swapBuffer(buffer);
}

export function setMonitor(monitor: Monitor): void {
  if (monitor === "processed" && !processedBuffer) return;
  filterStore.set({ monitor });
  listenTo(monitor);
}

function releaseProcessed(): void {
  clearTimeout(renderTimer);
  clearTimeout(spectrumTimer);
  if (filterStore.get().monitor === "processed") listenTo("original");
  processedBuffer = null;
  cancelJob("filter");
  cancelJob("processedSpectrum");
  analysisClient().clearProcessed();
  filterStore.set({ monitor: "original", rendered: null, processedSpectrum: null });
}

function runProcessedSpectrum(): void {
  const { rendered } = filterStore.get();
  const recording = audioStore.get().recording;
  if (!rendered || !recording) return;
  const { fftSize, windowFunction, channel } = settingsStore.get();
  const range = scopeRange();
  void track("processedSpectrum", (onProgress) =>
    analysisClient().run(
      "processedSpectrum",
      { range, channel, fftSize, windowFunction },
      onProgress,
    ),
  ).then((processedSpectrum) => {
    if (processedSpectrum && audioStore.get().recording?.id === recording.id) {
      filterStore.set({ processedSpectrum });
    }
  });
}

function runRender(): void {
  const { filters } = filterStore.get();
  const recording = audioStore.get().recording;
  if (!recording) return;
  const key = chainKey(filters);
  if (key === filterStore.get().rendered?.key) return;
  void track("filter", (onProgress) =>
    analysisClient().run("filter", { filters }, onProgress),
  ).then((result) => {
    if (!result || audioStore.get().recording?.id !== recording.id) return;
    const { sampleRate, channelCount, frameCount } = recording.decoded;
    const buffer = new AudioBuffer({
      length: frameCount,
      numberOfChannels: channelCount,
      sampleRate,
    });
    result.channels.forEach((channel, c) => {
      buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, c);
    });
    processedBuffer = buffer;
    const { peakDb, rmsDb, overRangeSamples } = result;
    filterStore.set({ rendered: { key, peakDb, rmsDb, overRangeSamples } });
    if (filterStore.get().monitor === "processed") listenTo("processed");
    runProcessedSpectrum();
  });
}

function filtersChanged(filters: FilterConfiguration[]): void {
  filterStore.set({ filters });
  clearTimeout(renderTimer);
  if (filters.some((f) => f.enabled)) renderTimer = setTimeout(runRender, 250);
  else if (filterStore.get().rendered || processedBuffer) releaseProcessed();
  else cancelJob("filter");
}

export function addFilter(filterType: FilterType): void {
  const { filters } = filterStore.get();
  if (filters.length >= MAX_FILTERS) return;
  const sampleRate = audioStore.get().recording?.decoded.sampleRate ?? 48000;
  const defaults = DEFAULTS[filterType];
  filtersChanged([
    ...filters,
    {
      ...defaults,
      id: `filter-${nextId++}`,
      filterType,
      frequency: Math.min(defaults.frequency, maxDesignFrequency(sampleRate)),
      order: 2,
      enabled: true,
    },
  ]);
}

export function updateFilter(id: string, patch: Partial<FilterConfiguration>): void {
  filtersChanged(filterStore.get().filters.map((f) => (f.id === id ? { ...f, ...patch } : f)));
}

/** Changes the type and moves to that type's defaults, which rarely suit the previous type. */
export function changeFilterType(id: string, filterType: FilterType): void {
  const sampleRate = audioStore.get().recording?.decoded.sampleRate ?? 48000;
  const defaults = DEFAULTS[filterType];
  updateFilter(id, {
    ...defaults,
    filterType,
    frequency: Math.min(defaults.frequency, maxDesignFrequency(sampleRate)),
    order: 2,
  });
}

export function removeFilter(id: string): void {
  filtersChanged(filterStore.get().filters.filter((f) => f.id !== id));
}

export function resetFilters(): void {
  filtersChanged([]);
}

function scheduleProcessedSpectrum(): void {
  clearTimeout(spectrumTimer);
  if (filterStore.get().rendered) spectrumTimer = setTimeout(runProcessedSpectrum, 120);
}

selectionStore.subscribe(scheduleProcessedSpectrum);
settingsStore.subscribe(scheduleProcessedSpectrum);

let recordingId = audioStore.get().recording?.id;
audioStore.subscribe(() => {
  const id = audioStore.get().recording?.id;
  if (id === recordingId) return;
  recordingId = id;
  // A chain belongs to one recording: frequencies and audible results do not carry over.
  clearTimeout(renderTimer);
  clearTimeout(spectrumTimer);
  processedBuffer = null;
  filterStore.set({ filters: [], monitor: "original", rendered: null, processedSpectrum: null });
});
