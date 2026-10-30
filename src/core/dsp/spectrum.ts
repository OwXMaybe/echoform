import type {
  JobControl,
  SampleRange,
  SpectrumResult,
  WindowFunction,
} from "@/types/analysis";
import { NO_CONTROL } from "@/types/analysis";
import { FFT } from "./fft";
import { createWindow } from "./windows";

/** Stored level for bins with no energy; well below any 32-bit float signal. */
export const DB_FLOOR = -240;

export function powerToDb(power: number): number {
  return power > 1e-24 ? 10 * Math.log10(power) : DB_FLOOR;
}

/**
 * Computes one-sided power per bin, scaled so a sine of amplitude A centred on a
 * bin reads A^2 (0 dB for a full-scale sine), whatever the window or FFT size.
 */
export class FrameAnalyzer {
  readonly fftSize: number;
  readonly bins: number;
  private readonly fft: FFT;
  private readonly window: Float64Array;
  private readonly windowSum: number;
  private readonly windowType: WindowFunction;
  private readonly re: Float64Array;
  private readonly im: Float64Array;

  constructor(fftSize: number, windowType: WindowFunction) {
    this.fftSize = fftSize;
    this.bins = fftSize / 2 + 1;
    this.fft = new FFT(fftSize);
    this.window = createWindow(windowType, fftSize);
    this.windowSum = this.window.reduce((a, b) => a + b, 0);
    this.windowType = windowType;
    this.re = new Float64Array(fftSize);
    this.im = new Float64Array(fftSize);
  }

  /**
   * Adds the power spectrum of the frame starting at `start` to `out`. Samples outside
   * `bounds` read as zero, so frames may overlap the ends of the signal.
   */
  addFrame(
    samples: Float32Array,
    start: number,
    out: Float64Array,
    bounds: SampleRange = { start: 0, end: samples.length },
  ): void {
    const n = this.fftSize;
    for (let i = 0; i < n; i++) {
      const p = start + i;
      this.re[i] = p >= bounds.start && p < bounds.end ? samples[p] * this.window[i] : 0;
      this.im[i] = 0;
    }
    this.accumulate(out, this.windowSum);
  }

  /** Analyses a range shorter than fftSize: windowed over its own length, then zero-padded. */
  addShortFrame(samples: Float32Array, start: number, length: number, out: Float64Array): void {
    const window = createWindow(this.windowType, length);
    let sum = 0;
    this.re.fill(0);
    this.im.fill(0);
    for (let i = 0; i < length; i++) {
      this.re[i] = samples[start + i] * window[i];
      sum += window[i];
    }
    this.accumulate(out, sum);
  }

  private accumulate(out: Float64Array, windowSum: number): void {
    this.fft.transform(this.re, this.im);
    const norm = windowSum > 0 ? 1 / (windowSum * windowSum) : 0;
    const last = this.bins - 1;
    for (let k = 0; k <= last; k++) {
      const power = (this.re[k] * this.re[k] + this.im[k] * this.im[k]) * norm;
      out[k] += k === 0 || k === last ? power : 4 * power;
    }
  }
}

/** Averages frame powers with 50% overlap (Welch's method, unnormalised by bandwidth). */
export async function computeAverageSpectrum(
  samples: Float32Array,
  sampleRate: number,
  range: SampleRange,
  fftSize: number,
  windowFunction: WindowFunction,
  control: JobControl = NO_CONTROL,
): Promise<SpectrumResult> {
  const analyzer = new FrameAnalyzer(fftSize, windowFunction);
  const power = new Float64Array(analyzer.bins);
  const length = Math.max(0, range.end - range.start);
  const hop = fftSize >> 1;
  let frames = 0;
  if (length >= fftSize) {
    frames = Math.floor((length - fftSize) / hop) + 1;
    for (let i = 0; i < frames; i++) {
      analyzer.addFrame(samples, range.start + i * hop, power);
      if ((i & 127) === 0) await control.checkpoint(i / frames);
    }
  } else if (length > 0) {
    frames = 1;
    analyzer.addShortFrame(samples, range.start, length, power);
  }
  const levelDb = new Float32Array(analyzer.bins);
  for (let k = 0; k < analyzer.bins; k++) {
    levelDb[k] = powerToDb(frames > 0 ? power[k] / frames : 0);
  }
  return {
    levelDb,
    sampleRate,
    fftSize,
    windowFunction,
    frequencyResolution: sampleRate / fftSize,
    framesAveraged: frames,
    analysedSamples: length,
    zeroPadded: length < fftSize,
  };
}

export function binFrequency(bin: number, sampleRate: number, fftSize: number): number {
  return (bin * sampleRate) / fftSize;
}
