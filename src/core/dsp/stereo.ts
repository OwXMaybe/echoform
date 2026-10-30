import type { JobControl, SampleRange, StereoResult } from "@/types/analysis";
import { NO_CONTROL } from "@/types/analysis";

export const VECTORSCOPE_SIZE = 192;
const CORRELATION_BLOCK_SECONDS = 0.1;
const CHECKPOINT_SAMPLES = 1 << 18;

const levelDb = (linear: number): number | null => (linear > 0 ? 20 * Math.log10(linear) : null);

/** Normalised correlation at zero lag, without removing the mean; null if either side is silent. */
function correlationOf(sumLR: number, sumLL: number, sumRR: number): number | null {
  if (sumLL <= 0 || sumRR <= 0) return null;
  return Math.max(-1, Math.min(1, sumLR / Math.sqrt(sumLL * sumRR)));
}

/** Mid = (L + R) / 2, Side = (L - R) / 2. Levels use the same full scale as the channels. */
export async function analyseStereo(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  range: SampleRange = { start: 0, end: left.length },
  control: JobControl = NO_CONTROL,
): Promise<StereoResult> {
  const count = Math.max(0, range.end - range.start);
  const size = VECTORSCOPE_SIZE;
  const vectorscope = new Uint32Array(size * size);
  const blockSize = Math.max(1, Math.round(sampleRate * CORRELATION_BLOCK_SECONDS));
  const blocks = Math.floor(count / blockSize);
  const correlationOverTime = new Float32Array(blocks).fill(NaN);

  let sumLL = 0;
  let sumRR = 0;
  let sumLR = 0;
  let peakL = 0;
  let peakR = 0;
  let peakM = 0;
  let peakS = 0;
  let blockLL = 0;
  let blockRR = 0;
  let blockLR = 0;
  for (let i = range.start; i < range.end; i++) {
    const l = left[i];
    const r = right[i];
    const m = (l + r) / 2;
    const s = (l - r) / 2;
    sumLL += l * l;
    sumRR += r * r;
    sumLR += l * r;
    blockLL += l * l;
    blockRR += r * r;
    blockLR += l * r;
    if (Math.abs(l) > peakL) peakL = Math.abs(l);
    if (Math.abs(r) > peakR) peakR = Math.abs(r);
    if (Math.abs(m) > peakM) peakM = Math.abs(m);
    if (Math.abs(s) > peakS) peakS = Math.abs(s);

    const x = Math.floor(((s + 1) / 2) * size);
    const y = Math.floor(((m + 1) / 2) * size);
    if (x >= 0 && x < size && y >= 0 && y < size) vectorscope[y * size + x]++;

    const position = i - range.start + 1;
    if (position % blockSize === 0) {
      const block = position / blockSize - 1;
      if (block < blocks) {
        correlationOverTime[block] = correlationOf(blockLR, blockLL, blockRR) ?? NaN;
      }
      blockLL = blockRR = blockLR = 0;
    }
    if (position % CHECKPOINT_SAMPLES === 0) await control.checkpoint(position / count);
  }

  const n = Math.max(1, count);
  const leftRms = Math.sqrt(sumLL / n);
  const rightRms = Math.sqrt(sumRR / n);
  const midPower = (sumLL + sumRR + 2 * sumLR) / 4 / n;
  // Rounding can leave a tiny negative when the channels are exactly equal or opposite.
  const sidePower = Math.max(0, (sumLL + sumRR - 2 * sumLR) / 4 / n);
  const midRms = Math.sqrt(Math.max(0, midPower));
  const sideRms = Math.sqrt(sidePower);
  const leftDb = levelDb(leftRms);
  const rightDb = levelDb(rightRms);
  const total = midPower + sidePower;
  return {
    sampleCount: count,
    leftRmsDb: leftDb,
    rightRmsDb: rightDb,
    leftPeakDb: levelDb(peakL),
    rightPeakDb: levelDb(peakR),
    levelDifferenceDb: leftDb !== null && rightDb !== null ? leftDb - rightDb : null,
    correlation: correlationOf(sumLR, sumLL, sumRR),
    midRmsDb: levelDb(midRms),
    sideRmsDb: levelDb(sideRms),
    midPeakDb: levelDb(peakM),
    sidePeakDb: levelDb(peakS),
    sideToMidDb: midRms > 0 && sideRms > 0 ? 20 * Math.log10(sideRms / midRms) : null,
    width: total > 0 ? sidePower / total : null,
    correlationOverTime,
    correlationBlockSeconds: blockSize / sampleRate,
    vectorscope,
    vectorscopeSize: size,
  };
}

/** The whole-signal side channel, (L - R) / 2. */
export function sideSignal(left: Float32Array, right: Float32Array): Float32Array {
  const out = new Float32Array(left.length);
  for (let i = 0; i < out.length; i++) out[i] = (left[i] - right[i]) / 2;
  return out;
}
