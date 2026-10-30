import type { JobControl, PitchSummary, PitchTrack } from "@/types/analysis";
import { NO_CONTROL } from "@/types/analysis";
import { applySections, designBiquad, butterworthQs, type Biquad } from "./filters";

export const MIN_PITCH_HZ = 60;
export const MAX_PITCH_HZ = 2000;
const TARGET_RATE = 16000;
const HOP_SECONDS = 0.01;
const WINDOW_SECONDS = 0.02;
/** YIN's absolute threshold: the first dip below this is taken as the period. */
const DIP_THRESHOLD = 0.15;
/** Frames more aperiodic than this show no pitch. */
export const MAX_APERIODICITY = 0.3;
const MIN_FRAME_RMS = 0.002;

/** Integer decimation, after an 8th-order Butterworth anti-alias filter. */
async function decimate(
  samples: Float32Array,
  sampleRate: number,
  control: JobControl,
): Promise<{ signal: Float32Array; rate: number }> {
  const factor = Math.max(1, Math.floor(sampleRate / TARGET_RATE));
  if (factor === 1) return { signal: samples, rate: sampleRate };
  const rate = sampleRate / factor;
  const sections: Biquad[] = butterworthQs(8).map((q) =>
    designBiquad("lowpass", 0.45 * rate, q, 0, sampleRate),
  );
  const filtered = await applySections(samples, sections, {
    checkpoint: (progress) => control.checkpoint(progress * 0.2),
  });
  const signal = new Float32Array(Math.floor(filtered.length / factor));
  for (let i = 0; i < signal.length; i++) signal[i] = filtered[i * factor];
  return { signal, rate };
}

/**
 * Fundamental frequency by YIN (de Cheveigné and Kawahara, 2002): the cumulative mean normalised
 * difference function, its first dip below an absolute threshold, then parabolic interpolation.
 * The signal is first reduced to about 16 kHz. Pitch is only meaningful for one periodic source;
 * aperiodicity is stored per frame so that unreliable frames can be left out, not guessed.
 */
export async function trackPitch(
  samples: Float32Array,
  sampleRate: number,
  control: JobControl = NO_CONTROL,
): Promise<PitchTrack> {
  const { signal: x, rate } = await decimate(samples, sampleRate, control);
  const tauMax = Math.ceil(rate / MIN_PITCH_HZ);
  const tauMin = Math.max(2, Math.floor(rate / MAX_PITCH_HZ));
  const window = Math.max(tauMax, Math.round(WINDOW_SECONDS * rate));
  const hop = Math.max(1, Math.round(HOP_SECONDS * rate));
  const frames = Math.max(0, Math.floor((x.length - window - tauMax - 1) / hop) + 1);
  const frequency = new Float32Array(frames).fill(NaN);
  const aperiodicity = new Float32Array(frames).fill(1);
  const d = new Float64Array(tauMax + 2);
  const minEnergy = MIN_FRAME_RMS * MIN_FRAME_RMS * window;

  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    let energy = 0;
    for (let j = 0; j < window; j++) energy += x[start + j] * x[start + j];
    if ((f & 255) === 0) await control.checkpoint(0.2 + (0.8 * f) / frames);
    if (energy < minEnergy) continue;

    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      let sum = 0;
      for (let j = 0; j < window; j++) {
        const delta = x[start + j] - x[start + j + tau];
        sum += delta * delta;
      }
      running += sum;
      d[tau] = running > 0 ? (sum * tau) / running : 1;
    }

    let best = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (d[tau] < DIP_THRESHOLD) {
        while (tau < tauMax && d[tau + 1] < d[tau]) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) {
      best = tauMin;
      for (let tau = tauMin; tau <= tauMax; tau++) if (d[tau] < d[best]) best = tau;
    }
    // A minimum on the edge of the search is a period outside the range, not a measurement.
    if (best >= tauMax) continue;
    const a = d[best - 1];
    const b = d[best];
    const c = d[best + 1];
    const denominator = a - 2 * b + c;
    const shift = denominator > 0 ? Math.max(-1, Math.min(1, (0.5 * (a - c)) / denominator)) : 0;
    const dip = Math.max(0, Math.min(1, b - 0.25 * (a - c) * shift));
    aperiodicity[f] = dip;
    if (dip <= MAX_APERIODICITY && best > tauMin) frequency[f] = rate / (best + shift);
  }
  return {
    frequency,
    aperiodicity,
    hopSeconds: hop / rate,
    startSeconds: (window + tauMax) / 2 / rate,
    analysedHz: 0.45 * rate,
  };
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** Single figures for the frames between two times; null where no frame has a reliable pitch. */
export function summarisePitch(track: PitchTrack, start: number, end: number): PitchSummary {
  const first = Math.max(0, Math.ceil((start - track.startSeconds) / track.hopSeconds));
  const last = Math.min(
    track.frequency.length - 1,
    Math.floor((end - track.startSeconds) / track.hopSeconds),
  );
  const voiced: number[] = [];
  const dips: number[] = [];
  for (let f = first; f <= last; f++) {
    if (Number.isNaN(track.frequency[f])) continue;
    voiced.push(track.frequency[f]);
    dips.push(track.aperiodicity[f]);
  }
  const frames = Math.max(0, last - first + 1);
  if (voiced.length === 0) {
    return { medianHz: null, voicedRatio: 0, harmonicToNoiseDb: null, frames };
  }
  const dip = median(dips);
  return {
    medianHz: median(voiced),
    voicedRatio: voiced.length / Math.max(1, frames),
    harmonicToNoiseDb: dip > 0 ? 10 * Math.log10((1 - dip) / dip) : null,
    frames,
  };
}

const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

/** Nearest equal-tempered note, with A4 = 440 Hz. */
export function frequencyToNote(hz: number): { name: string; cents: number } {
  const midi = 69 + 12 * Math.log2(hz / 440);
  const nearest = Math.round(midi);
  const octave = Math.floor(nearest / 12) - 1;
  return {
    name: `${NOTE_NAMES[((nearest % 12) + 12) % 12]}${octave}`,
    cents: (midi - nearest) * 100,
  };
}
