import type { JobControl, TempoCandidate, TempoResult } from "@/types/analysis";
import { NO_CONTROL } from "@/types/analysis";

const MIN_BPM = 40;
const MAX_BPM = 240;
const MIN_SECONDS = 4;
/** Periodicity below this is reported as no clear tempo. */
export const MIN_TEMPO_CONFIDENCE = 0.3;
const PREFERRED_BPM = 120;
const PREFERENCE_OCTAVES = 1.4;
const MAX_CANDIDATES = 4;
/** Onset strength below this is rounding noise in steady audio, not an event. */
const MIN_EVENT_STRENGTH = 0.2;

/** Allows a beat to wander by a frame or two without losing the correlation. */
function smooth(values: Float32Array): Float64Array {
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(values.length - 1, i + 2); j++) {
      sum += values[j];
      count++;
    }
    out[i] = sum / count;
  }
  return out;
}

function relationTo(bpm: number, best: number): TempoCandidate["relation"] {
  for (const [ratio, relation] of [
    [1, "best"],
    [2, "double"],
    [0.5, "half"],
    [1.5, "three-halves"],
    [2 / 3, "two-thirds"],
    [3, "triple"],
    [1 / 3, "third"],
  ] as const) {
    if (Math.abs(bpm / (best * ratio) - 1) < 0.04) return relation;
  }
  return "other";
}

/**
 * Tempo from the autocorrelation of an onset-strength curve. Every local maximum between 40 and
 * 240 BPM is a candidate. Periodicity is the normalised correlation at that lag; candidates are
 * ranked by periodicity weighted towards moderate tempi, because a pulse also correlates at
 * multiples of its period and the correlation alone cannot choose between them.
 * The weighting is a convention, so the alternatives are always returned.
 */
export async function estimateTempo(
  novelty: Float32Array,
  hopSeconds: number,
  control: JobControl = NO_CONTROL,
): Promise<TempoResult> {
  const none = (reason: string): TempoResult => ({
    bpm: null,
    confidence: 0,
    candidates: [],
    reason,
  });
  const analysedSeconds = novelty.length * hopSeconds;
  if (analysedSeconds < MIN_SECONDS) {
    return none(`Tempo needs at least ${MIN_SECONDS} seconds of audio.`);
  }

  let strongest = 0;
  for (let i = 1; i < novelty.length; i++) strongest = Math.max(strongest, novelty[i]);
  if (strongest < MIN_EVENT_STRENGTH) {
    return none("There are no level changes to measure a pulse from.");
  }

  const x = smooth(novelty);
  const n = x.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;
  let energy = 0;
  for (let i = 0; i < n; i++) {
    x[i] -= mean;
    energy += x[i] * x[i];
  }

  const minLag = Math.max(2, Math.floor(60 / MAX_BPM / hopSeconds));
  const maxLag = Math.min(n - 2, Math.ceil(60 / MIN_BPM / hopSeconds));
  const acf = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += x[i] * x[i + lag];
    // Dividing by the overlap stops long lags reading low merely for having fewer terms.
    acf[lag] = (sum / (n - lag)) * (n / energy);
    if ((lag & 63) === 0) await control.checkpoint(lag / maxLag);
  }

  const peaks: { bpm: number; periodicity: number; score: number }[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    const a = acf[lag - 1];
    const b = acf[lag];
    const c = acf[lag + 1];
    if (b <= 0 || b < a || b <= c) continue;
    const denominator = a - 2 * b + c;
    const shift = denominator !== 0 ? (0.5 * (a - c)) / denominator : 0;
    const bpm = 60 / ((lag + shift) * hopSeconds);
    if (bpm < MIN_BPM || bpm > MAX_BPM) continue;
    const octaves = Math.log2(bpm / PREFERRED_BPM) / PREFERENCE_OCTAVES;
    const periodicity = Math.min(1, b);
    peaks.push({ bpm, periodicity, score: periodicity * Math.exp(-0.5 * octaves * octaves) });
  }
  if (peaks.length === 0) return none("No repeating pulse was found.");

  peaks.sort((p, q) => q.score - p.score);
  const best = peaks[0];
  const candidates = peaks.slice(0, MAX_CANDIDATES).map(({ bpm, periodicity }) => ({
    bpm,
    periodicity,
    relation: relationTo(bpm, best.bpm),
  }));
  if (best.periodicity < MIN_TEMPO_CONFIDENCE) {
    return {
      ...none("The level changes do not repeat strongly enough to report a tempo."),
      confidence: best.periodicity,
      candidates,
    };
  }
  return { bpm: best.bpm, confidence: best.periodicity, candidates, reason: null };
}
