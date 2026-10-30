import type { JobControl, WaveformLevel, WaveformPyramid } from "@/types/analysis";
import { NO_CONTROL } from "@/types/analysis";

const BASE_BLOCK = 256;
const LEVEL_FACTOR = 4;
const MIN_LEVEL_BLOCKS = 1024;

/** Multiresolution min/max peaks. Every coarser level is derived from the one below it. */
export async function buildWaveformPyramid(
  samples: Float32Array,
  control: JobControl = NO_CONTROL,
): Promise<WaveformPyramid> {
  const blocks = Math.ceil(samples.length / BASE_BLOCK);
  const base: WaveformLevel = {
    blockSize: BASE_BLOCK,
    min: new Float32Array(blocks),
    max: new Float32Array(blocks),
  };
  for (let b = 0; b < blocks; b++) {
    let lo = Infinity;
    let hi = -Infinity;
    const end = Math.min(samples.length, (b + 1) * BASE_BLOCK);
    for (let i = b * BASE_BLOCK; i < end; i++) {
      const x = samples[i];
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    base.min[b] = lo;
    base.max[b] = hi;
    if ((b & 16383) === 0) await control.checkpoint(b / blocks);
  }

  const pyramid: WaveformPyramid = [base];
  let previous = base;
  while (previous.min.length > MIN_LEVEL_BLOCKS) {
    const count = Math.ceil(previous.min.length / LEVEL_FACTOR);
    const level: WaveformLevel = {
      blockSize: previous.blockSize * LEVEL_FACTOR,
      min: new Float32Array(count),
      max: new Float32Array(count),
    };
    for (let b = 0; b < count; b++) {
      const end = Math.min(previous.min.length, (b + 1) * LEVEL_FACTOR);
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = b * LEVEL_FACTOR; i < end; i++) {
        if (previous.min[i] < lo) lo = previous.min[i];
        if (previous.max[i] > hi) hi = previous.max[i];
      }
      level.min[b] = lo;
      level.max[b] = hi;
    }
    pyramid.push(level);
    previous = level;
  }
  return pyramid;
}

/** Coarsest level whose blocks still fit inside one output pixel, or null to read raw samples. */
export function selectLevel(pyramid: WaveformPyramid, samplesPerPixel: number): WaveformLevel | null {
  let chosen: WaveformLevel | null = null;
  for (const level of pyramid) {
    if (level.blockSize <= samplesPerPixel) chosen = level;
  }
  return chosen;
}
