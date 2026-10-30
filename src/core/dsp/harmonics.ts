import type { HarmonicResult, HarmonicRow } from "@/types/analysis";

const MAX_HARMONICS = 12;
/** Below this many bins between harmonics, neighbouring harmonics cannot be told apart. */
const MIN_BINS_PER_HARMONIC = 4;
const MIN_PROMINENCE_DB = 6;
const MIN_LEVEL_DB = -100;

/** Looks for each multiple of f0 in a level spectrum and reports what is actually there. */
export function analyseHarmonics(
  levelDb: Float32Array,
  sampleRate: number,
  fftSize: number,
  fundamentalHz: number,
): HarmonicResult {
  const binHz = sampleRate / fftSize;
  if (fundamentalHz / binHz < MIN_BINS_PER_HARMONIC) {
    return { fundamentalHz, rows: [], resolvable: false };
  }
  const reach = Math.max(2, Math.floor((fundamentalHz * 0.25) / binHz));
  const rows: HarmonicRow[] = [];
  for (let number = 1; number <= MAX_HARMONICS; number++) {
    const expectedHz = number * fundamentalHz;
    if (expectedHz >= sampleRate / 2) break;
    const centre = Math.round(expectedHz / binHz);
    const from = Math.max(1, centre - reach);
    const to = Math.min(levelDb.length - 2, centre + reach);
    let peak = from;
    for (let k = from; k <= to; k++) if (levelDb[k] > levelDb[peak]) peak = k;
    const edge = Math.max(levelDb[from], levelDb[to]);
    const found =
      peak > from &&
      peak < to &&
      levelDb[peak] >= MIN_LEVEL_DB &&
      levelDb[peak] - edge >= MIN_PROMINENCE_DB;
    if (!found) {
      rows.push({ number, expectedHz, measuredHz: null, levelDb: null, relativeDb: null, deviationCents: null });
      continue;
    }
    const a = levelDb[peak - 1];
    const b = levelDb[peak];
    const c = levelDb[peak + 1];
    const denominator = a - 2 * b + c;
    const shift = denominator < 0 ? (0.5 * (a - c)) / denominator : 0;
    const measuredHz = (peak + shift) * binHz;
    rows.push({
      number,
      expectedHz,
      measuredHz,
      levelDb: b - 0.25 * (a - c) * shift,
      relativeDb: null,
      deviationCents: 1200 * Math.log2(measuredHz / expectedHz),
    });
  }
  const levels = rows.flatMap((row) => (row.levelDb === null ? [] : [row.levelDb]));
  const reference = rows[0]?.levelDb ?? (levels.length ? Math.max(...levels) : null);
  if (reference !== null) {
    for (const row of rows) if (row.levelDb !== null) row.relativeDb = row.levelDb - reference;
  }
  return { fundamentalHz, rows, resolvable: true };
}
