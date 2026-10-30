import type {
  JobControl,
  OffsetEstimate,
  SampleRange,
  WaveformEnvelope,
} from "@/types/analysis";
import { NO_CONTROL } from "@/types/analysis";
import { FFT } from "./fft";
import { DB_FLOOR, powerToDb } from "./spectrum";

/** Zero crossings per second. A zero sample keeps the previous sign. */
export function zeroCrossingRate(
  samples: Float32Array,
  sampleRate: number,
  range: SampleRange = { start: 0, end: samples.length },
): number | null {
  const count = range.end - range.start;
  if (count < 2) return null;
  let crossings = 0;
  let sign = 0;
  for (let i = range.start; i < range.end; i++) {
    const s = samples[i] > 0 ? 1 : samples[i] < 0 ? -1 : 0;
    if (s === 0) continue;
    if (sign !== 0 && s !== sign) crossings++;
    sign = s;
  }
  return (crossings * sampleRate) / count;
}

/** Log-spaced frequencies shared by two spectra, whatever their sample rates. */
export function logFrequencyGrid(minHz: number, maxHz: number, points: number): Float32Array {
  const grid = new Float32Array(points);
  const ratio = Math.log(maxHz / minHz);
  for (let i = 0; i < points; i++) grid[i] = minHz * Math.exp((ratio * i) / (points - 1));
  return grid;
}

/**
 * Moves a level spectrum onto a frequency grid. Where a grid step spans several bins their power is
 * averaged, which keeps noise levels comparable across FFT sizes and sample rates but lowers a lone
 * tone, since its energy is shared across the band. Where it is finer, bins are interpolated.
 */
export function spectrumOnGrid(
  levelDb: Float32Array,
  sampleRate: number,
  fftSize: number,
  grid: Float32Array,
): Float32Array {
  const binHz = sampleRate / fftSize;
  const last = levelDb.length - 1;
  const out = new Float32Array(grid.length);
  for (let g = 0; g < grid.length; g++) {
    const previous = g > 0 ? grid[g - 1] : grid[g];
    const next = g < grid.length - 1 ? grid[g + 1] : grid[g];
    const b0 = Math.ceil(Math.sqrt(previous * grid[g]) / binHz);
    const b1 = Math.floor(Math.sqrt(grid[g] * next) / binHz);
    if (b1 > b0) {
      let power = 0;
      const end = Math.min(last, b1);
      for (let b = b0; b <= end; b++) power += Math.pow(10, levelDb[b] / 10);
      out[g] = powerToDb(power / Math.max(1, end - b0 + 1));
    } else {
      const position = Math.min(last - 1e-3, grid[g] / binHz);
      const bin = Math.floor(position);
      out[g] = levelDb[bin] + (position - bin) * (levelDb[bin + 1] - levelDb[bin]);
    }
  }
  return out;
}

/** Column-wise minimum and maximum of a sample range. */
export function waveformEnvelope(
  samples: Float32Array,
  range: SampleRange,
  columns: number,
  gain = 1,
): WaveformEnvelope {
  const min = new Float32Array(columns);
  const max = new Float32Array(columns);
  const perColumn = (range.end - range.start) / columns;
  for (let c = 0; c < columns; c++) {
    const from = range.start + Math.floor(c * perColumn);
    const to = Math.max(from + 1, range.start + Math.floor((c + 1) * perColumn));
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = from; i < to && i < range.end; i++) {
      const x = samples[i] * gain;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    if (lo !== Infinity) {
      min[c] = lo;
      max[c] = hi;
    }
  }
  return { min, max };
}

/** a[n] - gain * b[n + bStart - a.start], with its envelope and RMS level. */
export async function waveformDifference(
  a: Float32Array,
  rangeA: SampleRange,
  b: Float32Array,
  startB: number,
  gain: number,
  columns: number,
  control: JobControl = NO_CONTROL,
): Promise<{ envelope: WaveformEnvelope; rmsDb: number | null }> {
  const length = rangeA.end - rangeA.start;
  const difference = new Float32Array(length);
  let sum = 0;
  for (let i = 0; i < length; i++) {
    const d = a[rangeA.start + i] - gain * b[startB + i];
    difference[i] = d;
    sum += d * d;
    if ((i & 0x3ffff) === 0) await control.checkpoint(i / length);
  }
  const db = powerToDb(sum / Math.max(1, length));
  return {
    envelope: waveformEnvelope(difference, { start: 0, end: length }, columns),
    rmsDb: db === DB_FLOOR ? null : db,
  };
}

const CORRELATION_RATE = 4000;
const MAX_CORRELATION_POINTS = 1 << 20;
const REFINE_SECONDS = 5;

/** Box-averaged decimation to a common rate, without the mean, and capped in length. */
function decimate(samples: Float32Array, sampleRate: number): Float64Array {
  const step = Math.max(1, sampleRate / CORRELATION_RATE);
  const points = Math.min(MAX_CORRELATION_POINTS, Math.floor(samples.length / step));
  const out = new Float64Array(points);
  let mean = 0;
  for (let p = 0; p < points; p++) {
    const from = Math.floor(p * step);
    const to = Math.max(from + 1, Math.floor((p + 1) * step));
    let sum = 0;
    for (let i = from; i < to; i++) sum += samples[i];
    out[p] = sum / (to - from);
    mean += out[p];
  }
  mean /= Math.max(1, points);
  for (let p = 0; p < points; p++) out[p] -= mean;
  return out;
}

/**
 * Estimates when B starts on A's timeline from the peak of their cross-correlation, computed on
 * decimated mono signals. A positive offset means B's first sample lines up with A at that time.
 * The result assumes both recordings contain the same material; `coefficient` shows how far to
 * trust it. With equal sample rates the lag is then refined to a single sample.
 */
export async function estimateOffset(
  a: Float32Array,
  rateA: number,
  b: Float32Array,
  rateB: number,
  control: JobControl = NO_CONTROL,
): Promise<OffsetEstimate> {
  const da = decimate(a, rateA);
  const db = decimate(b, rateB);
  const stepSeconds = Math.max(1 / rateA, 1 / CORRELATION_RATE);
  const empty = {
    offsetSeconds: 0,
    coefficient: null,
    resolutionSeconds: stepSeconds,
    analysedSeconds: Math.min(da.length, db.length) / CORRELATION_RATE,
  };
  if (da.length < 2 || db.length < 2) return empty;

  let size = 2;
  while (size < da.length + db.length) size <<= 1;
  const fft = new FFT(size);
  const aRe = new Float64Array(size);
  const aIm = new Float64Array(size);
  const bRe = new Float64Array(size);
  const bIm = new Float64Array(size);
  aRe.set(da);
  bRe.set(db);
  fft.transform(aRe, aIm);
  await control.checkpoint(0.3);
  fft.transform(bRe, bIm);
  await control.checkpoint(0.5);
  // conj(A conj(B)) under a forward transform gives the inverse transform, reversed in sign of im.
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let k = 0; k < size; k++) {
    re[k] = aRe[k] * bRe[k] + aIm[k] * bIm[k];
    im[k] = -(aIm[k] * bRe[k] - aRe[k] * bIm[k]);
  }
  fft.transform(re, im);
  await control.checkpoint(0.7);

  // Short overlaps are excluded: a few matching samples can correlate perfectly by chance.
  const minOverlap = Math.max(1, Math.floor(Math.min(da.length, db.length) * 0.1));
  const maxLag = da.length - minOverlap;
  const minLag = minOverlap - db.length;
  let bestLag = 0;
  let best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const value = re[lag >= 0 ? lag : size + lag];
    if (value > best) {
      best = value;
      bestLag = lag;
    }
  }

  const prefix = (x: Float64Array) => {
    const out = new Float64Array(x.length + 1);
    for (let i = 0; i < x.length; i++) out[i + 1] = out[i] + x[i] * x[i];
    return out;
  };
  const energyA = prefix(da);
  const energyB = prefix(db);
  const startA = Math.max(0, bestLag);
  const startB = Math.max(0, -bestLag);
  const overlap = Math.min(da.length - startA, db.length - startB);
  const eA = energyA[startA + overlap] - energyA[startA];
  const eB = energyB[startB + overlap] - energyB[startB];
  const coefficient = eA > 0 && eB > 0 ? best / size / Math.sqrt(eA * eB) : null;

  const coarse = {
    offsetSeconds: bestLag / CORRELATION_RATE,
    coefficient: coefficient === null ? null : Math.max(-1, Math.min(1, coefficient)),
    resolutionSeconds: stepSeconds,
    analysedSeconds: Math.min(da.length, db.length) / CORRELATION_RATE,
  };
  if (rateA !== rateB || rateA <= CORRELATION_RATE) return coarse;
  const fine = refineLag(a, b, rateA, coarse.offsetSeconds);
  return {
    ...coarse,
    offsetSeconds: fine.lag / rateA,
    // A lag between decimated samples understates the match, so this replaces the coarse value.
    coefficient: fine.coefficient ?? coarse.coefficient,
    resolutionSeconds: 1 / rateA,
  };
}

/** Finds the best lag in samples within one decimation step of a coarse estimate. */
function refineLag(
  a: Float32Array,
  b: Float32Array,
  rate: number,
  coarseSeconds: number,
): { lag: number; coefficient: number | null } {
  const centre = Math.round(coarseSeconds * rate);
  const reach = Math.ceil(rate / CORRELATION_RATE) + 1;
  const length = Math.round(REFINE_SECONDS * rate);
  let bestLag = centre;
  let best = -Infinity;
  let coefficient: number | null = null;
  for (let lag = centre - reach; lag <= centre + reach; lag++) {
    const startA = Math.max(0, lag);
    const startB = Math.max(0, -lag);
    const count = Math.min(length, a.length - startA, b.length - startB);
    let sum = 0;
    let energyA = 0;
    let energyB = 0;
    for (let i = 0; i < count; i++) {
      const x = a[startA + i];
      const y = b[startB + i];
      sum += x * y;
      energyA += x * x;
      energyB += y * y;
    }
    if (sum > best) {
      best = sum;
      bestLag = lag;
      coefficient = energyA > 0 && energyB > 0 ? sum / Math.sqrt(energyA * energyB) : null;
    }
  }
  return { lag: bestLag, coefficient };
}
