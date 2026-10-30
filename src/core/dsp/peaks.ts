import type { PeakDetectionOptions, SpectralPeak } from "@/types/analysis";

const BANDS: ReadonlyArray<readonly [number, string]> = [
  [60, "Sub-bass"],
  [250, "Bass"],
  [500, "Low mids"],
  [2000, "Mids"],
  [4000, "Upper mids"],
  [6000, "Presence"],
  [Infinity, "Brilliance"],
];

export function frequencyBand(hz: number): string {
  return BANDS.find(([limit]) => hz < limit)![1];
}

export const DEFAULT_PEAK_OPTIONS: PeakDetectionOptions = {
  minProminenceDb: 12,
  minDistanceHz: 20,
  minLevelDb: -90,
  maxPeaks: 16,
};

/** Height of the peak above the higher of the lowest points on each side before a taller peak. */
function prominence(level: Float32Array, peak: number): number {
  const height = level[peak];
  let leftMin = height;
  for (let i = peak - 1; i >= 0 && level[i] <= height; i--) {
    if (level[i] < leftMin) leftMin = level[i];
  }
  let rightMin = height;
  for (let i = peak + 1; i < level.length && level[i] <= height; i++) {
    if (level[i] < rightMin) rightMin = level[i];
  }
  return height - Math.max(leftMin, rightMin);
}

/**
 * Finds prominent spectral peaks. A local maximum qualifies only if it clears the level
 * and prominence thresholds; closer peaks are then suppressed in favour of the stronger.
 * Frequency and level are refined by parabolic interpolation on the dB curve.
 */
export function detectPeaks(
  levelDb: Float32Array,
  sampleRate: number,
  fftSize: number,
  options: PeakDetectionOptions,
): SpectralPeak[] {
  const binHz = sampleRate / fftSize;
  const candidates: SpectralPeak[] = [];
  const last = levelDb.length - 1;
  for (let i = 1; i < last; i++) {
    if (levelDb[i] <= levelDb[i - 1] || levelDb[i] < options.minLevelDb) continue;
    let end = i;
    while (end < last && levelDb[end + 1] === levelDb[i]) end++;
    if (end === last || levelDb[end + 1] > levelDb[i]) {
      i = end;
      continue;
    }
    const centre = (i + end) >> 1;
    const prominenceDb = prominence(levelDb, centre);
    if (prominenceDb >= options.minProminenceDb) {
      let offset = 0;
      // A two-bin plateau is a tone midway between bins; only wider ones are truly flat.
      if (end - i <= 1) {
        const a = levelDb[i - 1];
        const b = levelDb[i];
        const c = levelDb[i + 1];
        const denominator = a - 2 * b + c;
        offset = denominator !== 0 ? (0.5 * (a - c)) / denominator : 0;
      }
      const frequencyHz = (centre + offset) * binHz;
      candidates.push({
        frequencyHz,
        levelDb:
          levelDb[centre] - (0.25 * (levelDb[centre - 1] - levelDb[centre + 1]) * offset),
        prominenceDb,
        band: frequencyBand(frequencyHz),
      });
    }
    i = end;
  }
  candidates.sort((a, b) => b.levelDb - a.levelDb);
  const minDistance = Math.max(options.minDistanceHz, 2 * binHz);
  const kept: SpectralPeak[] = [];
  for (const peak of candidates) {
    if (kept.length >= options.maxPeaks) break;
    if (options.minHz !== undefined && peak.frequencyHz < options.minHz) continue;
    if (options.maxHz !== undefined && peak.frequencyHz > options.maxHz) continue;
    if (kept.every((k) => Math.abs(k.frequencyHz - peak.frequencyHz) >= minDistance)) {
      kept.push(peak);
    }
  }
  return kept;
}
