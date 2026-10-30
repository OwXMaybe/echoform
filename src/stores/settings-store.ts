import {
  parseStoredSettings,
  SETTINGS_STORAGE_KEY,
  STORED_SETTING_KEYS,
} from "@/core/settings/stored-settings";
import type { ColorMapName } from "@/core/visualization/color-maps";
import type {
  ChannelSelection,
  FftSize,
  FrequencyScale,
  WindowFunction,
} from "@/types/analysis";
import { createStore } from "./create-store";

export type SpectrumSource = "scope" | "playhead";

export interface SettingsState {
  fftSize: FftSize;
  /** Hop as a fraction of the FFT size: hop = fftSize / hopDivisor. */
  hopDivisor: 2 | 4 | 8 | 16;
  windowFunction: WindowFunction;
  frequencyScale: FrequencyScale;
  channel: ChannelSelection;
  dynamicRangeDb: number;
  colorMap: ColorMapName;
  /** null means automatic: the full range for the sample rate. */
  viewMinHz: number | null;
  viewMaxHz: number | null;
  peakProminenceDb: number;
  spectrumSource: SpectrumSource;
  /** Exponential smoothing of the playhead spectrum, 0 for none. */
  liveSmoothing: number;
  regionTool: boolean;
  rolloffPercent: number;
  silenceThresholdDb: number;
  silenceMinSeconds: number;
  silencePaddingSeconds: number;
  /** Absolute mean above which a DC offset warning is shown. */
  dcWarningThreshold: number;
  reportIncludeFileNames: boolean;
  /** Off by default: nothing is written to the device until the user asks for it. */
  rememberSettings: boolean;
}

const DEFAULTS: SettingsState = {
  fftSize: 2048,
  hopDivisor: 4,
  windowFunction: "hann",
  frequencyScale: "log",
  channel: "mix",
  dynamicRangeDb: 96,
  colorMap: "magma",
  viewMinHz: null,
  viewMaxHz: null,
  peakProminenceDb: 12,
  spectrumSource: "scope",
  liveSmoothing: 0.6,
  regionTool: false,
  rolloffPercent: 85,
  silenceThresholdDb: -60,
  silenceMinSeconds: 0.5,
  silencePaddingSeconds: 0,
  dcWarningThreshold: 0.01,
  reportIncludeFileNames: true,
  rememberSettings: false,
};

export const settingsStore = createStore<SettingsState>({ ...DEFAULTS });

function writeStored(): void {
  const state = settingsStore.get();
  const stored = Object.fromEntries(STORED_SETTING_KEYS.map((key) => [key, state[key]]));
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage can be blocked or full. Settings then simply last for this session.
  }
}

/** Applies stored preferences. Called after hydration, so the first render matches the server. */
export function loadStoredSettings(): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
  } catch {
    return;
  }
  if (raw === null) return;
  settingsStore.set({ ...parseStoredSettings(raw), rememberSettings: true } as Partial<SettingsState>);
}

export function setRememberSettings(rememberSettings: boolean): void {
  settingsStore.set({ rememberSettings });
  if (rememberSettings) {
    writeStored();
    return;
  }
  try {
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
  } catch {
    // Nothing could have been stored either.
  }
}

/** Restores the defaults for preferences, keeping the choice of whether to remember them. */
export function resetSettings(): void {
  const defaults = Object.fromEntries(STORED_SETTING_KEYS.map((key) => [key, DEFAULTS[key]]));
  settingsStore.set(defaults as Partial<SettingsState>);
}

settingsStore.subscribe(() => {
  if (settingsStore.get().rememberSettings) writeStored();
});
