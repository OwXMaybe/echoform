import { COLOR_MAPS } from "@/core/visualization/color-maps";
import { FFT_SIZES, WINDOW_FUNCTIONS } from "@/types/analysis";

export const SETTINGS_STORAGE_KEY = "echoform.settings.v1";

const between = (min: number, max: number) => (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const oneOf = (options: readonly unknown[]) => (value: unknown) => options.includes(value);

/** Only preferences. Selections, channels and anything about a recording are never stored. */
const VALIDATORS = {
  fftSize: oneOf(FFT_SIZES),
  hopDivisor: oneOf([2, 4, 8, 16]),
  windowFunction: oneOf(WINDOW_FUNCTIONS),
  frequencyScale: oneOf(["log", "linear"]),
  dynamicRangeDb: oneOf([60, 72, 96, 120, 144]),
  colorMap: oneOf(Object.keys(COLOR_MAPS)),
  peakProminenceDb: between(3, 40),
  liveSmoothing: between(0, 0.95),
  rolloffPercent: between(50, 99),
  silenceThresholdDb: between(-120, -20),
  silenceMinSeconds: between(0.05, 10),
  silencePaddingSeconds: between(0, 2),
  dcWarningThreshold: between(0.0001, 0.5),
  reportIncludeFileNames: (value: unknown) => typeof value === "boolean",
} as const;

export type StoredSettingKey = keyof typeof VALIDATORS;
export const STORED_SETTING_KEYS = Object.keys(VALIDATORS) as StoredSettingKey[];

/**
 * Reads stored preferences. Storage can be edited or left over from another version, so each value
 * is checked on its own: an invalid one is dropped and the rest still apply.
 */
export function parseStoredSettings(raw: string | null): Partial<Record<StoredSettingKey, unknown>> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const out: Partial<Record<StoredSettingKey, unknown>> = {};
  for (const key of STORED_SETTING_KEYS) {
    const value = (parsed as Record<string, unknown>)[key];
    if (VALIDATORS[key](value)) out[key] = value;
  }
  return out;
}
