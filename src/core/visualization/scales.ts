import type { FrequencyScale } from "@/types/analysis";

export const MIN_LOG_FREQUENCY = 20;

export interface FrequencyAxis {
  min: number;
  max: number;
  scale: FrequencyScale;
}

/** Fraction 0..1 along the axis for a frequency. */
export function frequencyToFraction(hz: number, axis: FrequencyAxis): number {
  if (axis.scale === "linear") return (hz - axis.min) / (axis.max - axis.min);
  const lo = Math.max(axis.min, 1);
  return Math.log(Math.max(hz, 1e-9) / lo) / Math.log(axis.max / lo);
}

export function fractionToFrequency(fraction: number, axis: FrequencyAxis): number {
  if (axis.scale === "linear") return axis.min + fraction * (axis.max - axis.min);
  const lo = Math.max(axis.min, 1);
  return lo * Math.pow(axis.max / lo, fraction);
}

export function defaultFrequencyAxis(sampleRate: number, scale: FrequencyScale): FrequencyAxis {
  return { min: scale === "log" ? MIN_LOG_FREQUENCY : 0, max: sampleRate / 2, scale };
}

export function frequencyTicks(axis: FrequencyAxis): number[] {
  const ticks: number[] = [];
  if (axis.scale === "log") {
    for (let decade = 10; decade <= axis.max; decade *= 10) {
      for (const m of [1, 2, 5]) {
        const hz = decade * m;
        if (hz >= axis.min && hz <= axis.max) ticks.push(hz);
      }
    }
    return ticks;
  }
  return linearTicks(axis.min, axis.max, 8);
}

export function linearTicks(min: number, max: number, count: number): number[] {
  const span = max - min;
  if (span <= 0) return [min];
  const rough = span / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalised = rough / magnitude;
  const step = (normalised < 1.5 ? 1 : normalised < 3 ? 2 : normalised < 7 ? 5 : 10) * magnitude;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(v);
  return ticks;
}

export interface FrequencyViewSettings {
  frequencyScale: FrequencyScale;
  viewMinHz: number | null;
  viewMaxHz: number | null;
}

/** The default axis narrowed by the user's frequency range, when that range is valid. */
export function viewFrequencyAxis(
  sampleRate: number,
  settings: FrequencyViewSettings,
): FrequencyAxis {
  const axis = defaultFrequencyAxis(sampleRate, settings.frequencyScale);
  const max = Math.min(axis.max, settings.viewMaxHz ?? axis.max);
  const min = Math.max(axis.min, settings.viewMinHz ?? axis.min);
  return min < max ? { ...axis, min, max } : axis;
}
