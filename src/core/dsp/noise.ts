import type { HumIndicator, JobControl, NoiseResult, SampleRange } from "@/types/analysis";
import { NO_CONTROL } from "@/types/analysis";
import { shortTermLevels } from "./dynamics";
import { computeAverageSpectrum, DB_FLOOR } from "./spectrum";

const FRAME_SECONDS = 0.05;
const FLOOR_PERCENTILE = 5;
const SIGNAL_PERCENTILE = 95;
const MIN_FRAMES = 20;
/** Quiet and loud frames must differ this much before one can be read as background. */
const MIN_SEPARATION_DB = 10;
/** Frames this close to the floor count as background. */
const NEAR_FLOOR_DB = 3;
/** Share of frames near the floor needed to trust the separation. */
const MIN_QUIET_SHARE = 0.1;
const HUM_FFT_SIZE = 16384;
const HUM_PROMINENCE_DB = 12;

const percentile = (sorted: Float32Array, p: number) =>
  sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];

/** Looks for a narrow peak at either mains frequency, standing above the bins just around it. */
export async function detectHum(
  samples: Float32Array,
  sampleRate: number,
  range: SampleRange,
  control: JobControl = NO_CONTROL,
): Promise<HumIndicator[]> {
  if (range.end - range.start < HUM_FFT_SIZE) return [];
  const { levelDb, frequencyResolution: binHz } = await computeAverageSpectrum(
    samples,
    sampleRate,
    range,
    HUM_FFT_SIZE,
    "hann",
    control,
  );
  const found: HumIndicator[] = [];
  for (const hz of [50, 60]) {
    const centre = Math.round(hz / binHz);
    let peak = centre;
    for (let k = centre - 1; k <= centre + 1; k++) if (levelDb[k] > levelDb[peak]) peak = k;
    // Neighbours sit beyond the Hann main lobe, on both sides.
    const near = [-6, -5, -4, 4, 5, 6].map((offset) => levelDb[peak + offset]);
    const background = Math.max(...near);
    const prominenceDb = levelDb[peak] - background;
    if (levelDb[peak] > DB_FLOOR + 1 && prominenceDb >= HUM_PROMINENCE_DB) {
      found.push({ frequencyHz: hz, levelDb: levelDb[peak], prominenceDb });
    }
  }
  return found;
}

/**
 * Estimates background level from the quietest 50 ms frames. This assumes the range contains
 * passages with only background in them. That cannot be known from mixed audio, so the result
 * says how far the level distribution supports it, and gives no noise figure when it does not.
 */
export async function estimateNoise(
  samples: Float32Array,
  sampleRate: number,
  range: SampleRange,
  control: JobControl = NO_CONTROL,
): Promise<NoiseResult> {
  const blockSize = Math.round(sampleRate * FRAME_SECONDS);
  const levels = await shortTermLevels(samples, blockSize, range, control);
  const empty = {
    noiseFloorDb: null,
    signalLevelDb: null,
    snrDb: null,
    quietestDb: null,
    quietShare: 0,
    interval: null,
    hum: [] as HumIndicator[],
  };
  // Digital silence is not background noise; it says nothing about the noise when sound is present.
  const measured = levels.filter((db) => db > DB_FLOOR);
  if (measured.length < MIN_FRAMES) {
    return {
      ...empty,
      hum: await detectHum(samples, sampleRate, range, control),
      confidence: "none",
      reason: "Too little non-silent audio to estimate from.",
    };
  }
  const sorted = measured.slice().sort();
  const quietestDb = percentile(sorted, FLOOR_PERCENTILE);
  const signalLevelDb = percentile(sorted, SIGNAL_PERCENTILE);
  const nearFloor = (db: number) => db > DB_FLOOR && db <= quietestDb + NEAR_FLOOR_DB;
  const quietShare = measured.filter(nearFloor).length / measured.length;

  if (signalLevelDb - quietestDb < MIN_SEPARATION_DB) {
    return {
      ...empty,
      hum: await detectHum(samples, sampleRate, range, control),
      quietestDb,
      signalLevelDb,
      quietShare,
      confidence: "none",
      reason:
        "Level barely changes here, so quiet background cannot be separated from the signal. The quietest level is only an upper limit on any noise.",
    };
  }

  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  for (let i = 0; i <= levels.length; i++) {
    if (i < levels.length && nearFloor(levels[i])) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      if (i - runStart > bestLength) {
        bestStart = runStart;
        bestLength = i - runStart;
      }
      runStart = -1;
    }
  }
  const frame = blockSize / sampleRate;
  const offset = range.start / sampleRate;
  const interval =
    bestStart < 0
      ? null
      : { start: offset + bestStart * frame, end: offset + (bestStart + bestLength) * frame };

  // Louder passages would bury a hum, so it is looked for where the recording is quietest.
  const quiet = {
    start: range.start + Math.max(0, bestStart) * blockSize,
    end: range.start + (Math.max(0, bestStart) + bestLength) * blockSize,
  };
  const hum = await detectHum(
    samples,
    sampleRate,
    quiet.end - quiet.start >= HUM_FFT_SIZE ? quiet : range,
    control,
  );

  if (quietShare < MIN_QUIET_SHARE) {
    return {
      ...empty,
      hum,
      noiseFloorDb: quietestDb,
      signalLevelDb,
      quietestDb,
      quietShare,
      interval,
      confidence: "low",
      reason:
        "Quiet passages are rare here, so they may still contain signal. No signal-to-noise figure is given.",
    };
  }
  return {
    ...empty,
    hum,
    noiseFloorDb: quietestDb,
    signalLevelDb,
    snrDb: signalLevelDb - quietestDb,
    quietestDb,
    quietShare,
    interval,
    confidence: "moderate",
    reason: null,
  };
}
