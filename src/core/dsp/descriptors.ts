import type { SpectralDescriptors, WindowFunction } from "@/types/analysis";

export interface DescriptorOptions {
  windowFunction: WindowFunction;
  rolloffPercent: number;
  minHz?: number;
  maxHz?: number;
}

const NO_ENERGY_DB = -200;

/** First bin clear of the window's main lobe around DC: any offset smears into the bins below. */
const FIRST_BIN_CLEAR_OF_DC: Record<WindowFunction, number> = {
  rectangular: 1,
  hann: 2,
  hamming: 2,
  blackman: 3,
};

/**
 * Single-number summaries of a level spectrum, over a band if one is given. Bins dominated by DC
 * are excluded, so an offset does not drag results towards 0 Hz, and so is Nyquist, which is scaled
 * differently. Centroid weights frequency by amplitude; rolloff and flatness use power.
 */
export function computeDescriptors(
  levelDb: Float32Array,
  sampleRate: number,
  fftSize: number,
  options: DescriptorOptions,
): SpectralDescriptors {
  const binHz = sampleRate / fftSize;
  const first = Math.max(
    FIRST_BIN_CLEAR_OF_DC[options.windowFunction],
    Math.ceil((options.minHz ?? 0) / binHz),
  );
  const last = Math.min(
    levelDb.length - 2,
    Math.floor((options.maxHz ?? Infinity) / binHz),
  );
  const empty = { centroidHz: null, rolloffHz: null, flatness: null, flatnessDb: null };
  if (last < first) return empty;

  let totalAmplitude = 0;
  let weightedFrequency = 0;
  let totalPower = 0;
  let logPowerSum = 0;
  let peakDb = -Infinity;
  for (let k = first; k <= last; k++) {
    const db = levelDb[k];
    if (db > peakDb) peakDb = db;
    const amplitude = Math.pow(10, db / 20);
    const power = amplitude * amplitude;
    totalAmplitude += amplitude;
    weightedFrequency += k * binHz * amplitude;
    totalPower += power;
    logPowerSum += db / 10;
  }
  if (peakDb <= NO_ENERGY_DB) return empty;

  const target = totalPower * (options.rolloffPercent / 100);
  let cumulative = 0;
  let rolloffHz = last * binHz;
  for (let k = first; k <= last; k++) {
    cumulative += Math.pow(10, levelDb[k] / 10);
    if (cumulative >= target) {
      rolloffHz = k * binHz;
      break;
    }
  }

  const count = last - first + 1;
  const geometricMean = Math.pow(10, logPowerSum / count);
  const flatness = Math.min(1, geometricMean / (totalPower / count));
  return {
    centroidHz: weightedFrequency / totalAmplitude,
    rolloffHz,
    flatness,
    flatnessDb: flatness > 0 ? 10 * Math.log10(flatness) : null,
  };
}
