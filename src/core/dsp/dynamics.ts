import type {
  DynamicsResult,
  JobControl,
  SampleHistogram,
  SampleRange,
} from "@/types/analysis";
import { NO_CONTROL } from "@/types/analysis";
import { powerToDb } from "./spectrum";

export const SHORT_TERM_SECONDS = 0.1;
/** Blocks below this are treated as near-silence and excluded from the statistics. */
export const LEVEL_GATE_DB = -70;

const LEVEL_HISTOGRAM_MIN_DB = -96;
const LEVEL_HISTOGRAM_BIN_DB = 3;

/** RMS level in dBFS of consecutive non-overlapping blocks; DB_FLOOR for digital silence. */
export async function shortTermLevels(
  samples: Float32Array,
  blockSize: number,
  range: SampleRange = { start: 0, end: samples.length },
  control: JobControl = NO_CONTROL,
): Promise<Float32Array> {
  const blocks = Math.floor(Math.max(0, range.end - range.start) / blockSize);
  const levels = new Float32Array(blocks);
  for (let b = 0; b < blocks; b++) {
    const start = range.start + b * blockSize;
    let sum = 0;
    for (let i = start; i < start + blockSize; i++) sum += samples[i] * samples[i];
    levels[b] = powerToDb(sum / blockSize);
    if ((b & 1023) === 0) await control.checkpoint(b / blocks);
  }
  return levels;
}

function percentile(sorted: Float32Array, p: number): number {
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, rank)];
}

/** Distribution of short-term levels, with statistics over the blocks above the gate. */
export function analyseDynamics(levels: Float32Array): DynamicsResult {
  const bins = -LEVEL_HISTOGRAM_MIN_DB / LEVEL_HISTOGRAM_BIN_DB;
  const counts = new Uint32Array(bins);
  for (const db of levels) {
    if (db < LEVEL_HISTOGRAM_MIN_DB) continue;
    const bin = Math.floor((db - LEVEL_HISTOGRAM_MIN_DB) / LEVEL_HISTOGRAM_BIN_DB);
    counts[Math.min(bins - 1, bin)]++;
  }
  const gated = levels.filter((db) => db >= LEVEL_GATE_DB).sort();
  const base = {
    histogram: {
      counts,
      minDb: LEVEL_HISTOGRAM_MIN_DB,
      binDb: LEVEL_HISTOGRAM_BIN_DB,
    },
    blocks: levels.length,
    gatedBlocks: gated.length,
  };
  if (gated.length === 0) {
    return { ...base, p10Db: null, p50Db: null, p95Db: null, rangeDb: null };
  }
  const p10Db = percentile(gated, 10);
  const p95Db = percentile(gated, 95);
  return { ...base, p10Db, p50Db: percentile(gated, 50), p95Db, rangeDb: p95Db - p10Db };
}

/** Equal-width distribution of sample values over -1..1; over-range samples land in the end bins. */
export function sampleHistogram(
  samples: Float32Array,
  range: SampleRange = { start: 0, end: samples.length },
  bins = 101,
): SampleHistogram {
  const counts = new Uint32Array(bins);
  let overRange = 0;
  for (let i = range.start; i < range.end; i++) {
    const x = samples[i];
    if (x > 1 || x < -1) overRange++;
    const bin = Math.floor(((x + 1) / 2) * bins);
    counts[bin < 0 ? 0 : bin >= bins ? bins - 1 : bin]++;
  }
  return { counts, overRange };
}
