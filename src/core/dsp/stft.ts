import type { JobControl, SampleRange, SpectrogramResult, WindowFunction } from "@/types/analysis";
import { NO_CONTROL } from "@/types/analysis";
import { FrameAnalyzer, powerToDb } from "./spectrum";

export const MAX_SPECTROGRAM_CELLS = 16_000_000;

/**
 * Short-time Fourier transform. Frame c is centred on sample c * hop, with zeros beyond the
 * signal, so the columns span the whole recording. When the grid would exceed `maxCells`,
 * consecutive frames are power-averaged into one column rather than skipped, so no part of
 * the signal goes unanalysed; `framesPerColumn` reports that loss of time resolution. A `range`
 * analyses part of the recording at finer resolution, with real samples on either side of it.
 */
export async function computeSpectrogram(
  samples: Float32Array,
  sampleRate: number,
  fftSize: number,
  hopSize: number,
  windowFunction: WindowFunction,
  control: JobControl = NO_CONTROL,
  maxCells: number = MAX_SPECTROGRAM_CELLS,
  range: SampleRange = { start: 0, end: samples.length },
): Promise<SpectrogramResult> {
  const analyzer = new FrameAnalyzer(fftSize, windowFunction);
  const bins = analyzer.bins;
  const frames = Math.floor((range.end - range.start) / hopSize) + 1;
  const framesPerColumn = Math.max(1, Math.ceil((frames * bins) / maxCells));
  const columns = Math.ceil(frames / framesPerColumn);
  const data = new Float32Array(columns * bins);
  const power = new Float64Array(bins);
  const half = fftSize >> 1;
  let maxDb = -Infinity;

  for (let col = 0, frame = 0; col < columns; col++) {
    power.fill(0);
    const stop = Math.min(frames, frame + framesPerColumn);
    const count = stop - frame;
    for (; frame < stop; frame++) {
      analyzer.addFrame(samples, range.start + frame * hopSize - half, power);
      if ((frame & 63) === 0) await control.checkpoint(frame / frames);
    }
    const offset = col * bins;
    for (let k = 0; k < bins; k++) {
      const db = powerToDb(power[k] / count);
      data[offset + k] = db;
      if (db > maxDb) maxDb = db;
    }
  }

  return {
    data,
    columns,
    bins,
    sampleRate,
    fftSize,
    hopSize,
    startSeconds: range.start / sampleRate,
    framesPerColumn,
    windowFunction,
    frequencyResolution: sampleRate / fftSize,
    timeResolution: (hopSize * framesPerColumn) / sampleRate,
    maxDb,
  };
}

/** Column index containing time `seconds`. */
export function spectrogramColumnAt(result: SpectrogramResult, seconds: number): number {
  const frame = ((seconds - result.startSeconds) * result.sampleRate) / result.hopSize + 0.5;
  const col = Math.floor(frame / result.framesPerColumn);
  return Math.min(result.columns - 1, Math.max(0, col));
}
