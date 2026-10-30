import type { AmplitudeMeasurement, SampleRange } from "@/types/analysis";

/** 16-bit positive full scale (32767/32768) minus a margin for float rounding. */
export const FULL_SCALE_THRESHOLD = 0.99996;

export function amplitudeToDb(amplitude: number): number | null {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : null;
}

export function measureAmplitude(
  samples: Float32Array,
  range: SampleRange = { start: 0, end: samples.length },
): AmplitudeMeasurement {
  const start = Math.max(0, range.start);
  const end = Math.min(samples.length, range.end);
  let maxPositive = 0;
  let maxNegative = 0;
  let sum = 0;
  let sumSquares = 0;
  let clippedSamples = 0;
  for (let i = start; i < end; i++) {
    const x = samples[i];
    if (x > maxPositive) maxPositive = x;
    if (x < maxNegative) maxNegative = x;
    sum += x;
    sumSquares += x * x;
    if (x >= FULL_SCALE_THRESHOLD || x <= -FULL_SCALE_THRESHOLD) clippedSamples++;
  }
  const sampleCount = Math.max(0, end - start);
  const peak = Math.max(maxPositive, -maxNegative);
  const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
  const crestFactor = rms > 0 ? peak / rms : null;
  return {
    sampleCount,
    maxPositive,
    maxNegative,
    peak,
    mean: sampleCount > 0 ? sum / sampleCount : 0,
    rms,
    peakDbfs: amplitudeToDb(peak),
    rmsDbfs: amplitudeToDb(rms),
    crestFactor,
    crestFactorDb: crestFactor !== null ? amplitudeToDb(crestFactor) : null,
    clippedSamples,
  };
}
