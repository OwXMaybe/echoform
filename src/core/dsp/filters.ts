import type { JobControl } from "@/types/analysis";
import { NO_CONTROL } from "@/types/analysis";

export const FILTER_TYPES = [
  "lowpass",
  "highpass",
  "bandpass",
  "notch",
  "peaking",
  "lowshelf",
  "highshelf",
] as const;
export type FilterType = (typeof FILTER_TYPES)[number];

export const FILTER_ORDERS = [2, 4, 6, 8] as const;
export type FilterOrder = (typeof FILTER_ORDERS)[number];

export interface FilterConfiguration {
  id: string;
  filterType: FilterType;
  /** Cutoff, centre or shelf midpoint, depending on the type. */
  frequency: number;
  q: number;
  gainDb: number;
  /** Used by low-pass and high-pass only. */
  order: FilterOrder;
  enabled: boolean;
}

/** One second-order section, normalised so a0 = 1. */
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export const usesGain = (type: FilterType): boolean =>
  type === "peaking" || type === "lowshelf" || type === "highshelf";

export const usesOrder = (type: FilterType): boolean => type === "lowpass" || type === "highpass";

/** Above second order, Q is fixed by the Butterworth design. */
export const usesQ = (filter: Pick<FilterConfiguration, "filterType" | "order">): boolean =>
  !usesOrder(filter.filterType) || filter.order === 2;

/** Design frequencies stay just under Nyquist, where the bilinear transform has no solution. */
export const maxDesignFrequency = (sampleRate: number): number => sampleRate * 0.49;

/** Biquads from the Audio EQ Cookbook (R. Bristow-Johnson). */
export function designBiquad(
  type: FilterType,
  frequency: number,
  q: number,
  gainDb: number,
  sampleRate: number,
): Biquad {
  const hz = Math.max(1, Math.min(maxDesignFrequency(sampleRate), frequency));
  const w0 = (2 * Math.PI * hz) / sampleRate;
  const c = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.max(0.01, q));
  const A = Math.pow(10, gainDb / 40);
  const shelf = 2 * Math.sqrt(A) * alpha;

  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  switch (type) {
    case "lowpass":
      [b0, b1, b2] = [(1 - c) / 2, 1 - c, (1 - c) / 2];
      [a0, a1, a2] = [1 + alpha, -2 * c, 1 - alpha];
      break;
    case "highpass":
      [b0, b1, b2] = [(1 + c) / 2, -(1 + c), (1 + c) / 2];
      [a0, a1, a2] = [1 + alpha, -2 * c, 1 - alpha];
      break;
    case "bandpass":
      // The constant 0 dB peak form: the centre passes unchanged whatever the Q.
      [b0, b1, b2] = [alpha, 0, -alpha];
      [a0, a1, a2] = [1 + alpha, -2 * c, 1 - alpha];
      break;
    case "notch":
      [b0, b1, b2] = [1, -2 * c, 1];
      [a0, a1, a2] = [1 + alpha, -2 * c, 1 - alpha];
      break;
    case "peaking":
      [b0, b1, b2] = [1 + alpha * A, -2 * c, 1 - alpha * A];
      [a0, a1, a2] = [1 + alpha / A, -2 * c, 1 - alpha / A];
      break;
    case "lowshelf":
      b0 = A * (A + 1 - (A - 1) * c + shelf);
      b1 = 2 * A * (A - 1 - (A + 1) * c);
      b2 = A * (A + 1 - (A - 1) * c - shelf);
      a0 = A + 1 + (A - 1) * c + shelf;
      a1 = -2 * (A - 1 + (A + 1) * c);
      a2 = A + 1 + (A - 1) * c - shelf;
      break;
    case "highshelf":
      b0 = A * (A + 1 + (A - 1) * c + shelf);
      b1 = -2 * A * (A - 1 + (A + 1) * c);
      b2 = A * (A + 1 + (A - 1) * c - shelf);
      a0 = A + 1 - (A - 1) * c + shelf;
      a1 = 2 * (A - 1 - (A + 1) * c);
      a2 = A + 1 - (A - 1) * c - shelf;
      break;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Q of each section of an even-order Butterworth filter. */
export function butterworthQs(order: number): number[] {
  return Array.from({ length: order / 2 }, (_, k) => {
    return 1 / (2 * Math.cos(((2 * k + 1) * Math.PI) / (2 * order)));
  });
}

/** The second-order sections of one filter. */
export function filterSections(filter: FilterConfiguration, sampleRate: number): Biquad[] {
  const { filterType, frequency, q, gainDb, order } = filter;
  if (usesQ(filter)) return [designBiquad(filterType, frequency, q, gainDb, sampleRate)];
  return butterworthQs(order).map((sectionQ) =>
    designBiquad(filterType, frequency, sectionQ, 0, sampleRate),
  );
}

export const chainSections = (filters: FilterConfiguration[], sampleRate: number): Biquad[] =>
  filters.filter((f) => f.enabled).flatMap((f) => filterSections(f, sampleRate));

export interface FrequencyResponse {
  magnitudeDb: number;
  phaseRadians: number;
}

/** H(e^jw) of a cascade, evaluated exactly at one frequency. */
export function responseAt(
  sections: readonly Biquad[],
  hz: number,
  sampleRate: number,
): FrequencyResponse {
  const w = (2 * Math.PI * hz) / sampleRate;
  const c1 = Math.cos(w);
  const s1 = -Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = -Math.sin(2 * w);
  let magnitudeDb = 0;
  let phaseRadians = 0;
  for (const { b0, b1, b2, a1, a2 } of sections) {
    const numRe = b0 + b1 * c1 + b2 * c2;
    const numIm = b1 * s1 + b2 * s2;
    const denRe = 1 + a1 * c1 + a2 * c2;
    const denIm = a1 * s1 + a2 * s2;
    const power = (numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm);
    magnitudeDb += power > 0 ? 10 * Math.log10(power) : -300;
    phaseRadians += Math.atan2(numIm, numRe) - Math.atan2(denIm, denRe);
  }
  const wrapped = Math.atan2(Math.sin(phaseRadians), Math.cos(phaseRadians));
  return { magnitudeDb, phaseRadians: wrapped };
}

const CHECKPOINT_SAMPLES = 1 << 17;

/** Runs a cascade over a signal, in double precision, into a new array. The input is not changed. */
export async function applySections(
  samples: Float32Array,
  sections: readonly Biquad[],
  control: JobControl = NO_CONTROL,
): Promise<Float32Array> {
  const work = new Float64Array(samples);
  for (let s = 0; s < sections.length; s++) {
    const { b0, b1, b2, a1, a2 } = sections[s];
    let z1 = 0;
    let z2 = 0;
    for (let i = 0; i < work.length; i++) {
      // Transposed direct form II.
      const x = work[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      work[i] = y;
      if ((i + 1) % CHECKPOINT_SAMPLES === 0) {
        await control.checkpoint((s + (i + 1) / work.length) / sections.length);
      }
    }
  }
  return new Float32Array(work);
}
