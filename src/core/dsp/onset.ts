import type { JobControl, NoveltyResult, OnsetEvent, OnsetPicks } from "@/types/analysis";
import { NO_CONTROL } from "@/types/analysis";
import { FrameAnalyzer } from "./spectrum";

/** Sets how strongly quiet bins count: a bin below about 1 / COMPRESSION adds little flux. */
const COMPRESSION = 1000;
/** Scaling never goes below this, so rounding noise in steady audio is not enlarged into events. */
const MIN_FULL_SCALE_FLUX = 5;
const FALLING_POWER_RATIO = 0.5;
const ARRIVAL_CHECK_FRAMES = 3;
const FRAME_SECONDS = 0.0213;
const LOCAL_SECONDS = 0.25;
const MIN_GAP_SECONDS = 0.05;

function frameSizeFor(sampleRate: number): number {
  return Math.pow(2, Math.round(Math.log2(FRAME_SECONDS * sampleRate)));
}

/**
 * Onset strength by log-compressed spectral flux: per frame, the summed rise of compressed
 * magnitude in each bin. Falls in level are ignored, so only energy arriving counts.
 * Values are scaled so the strongest frame is 1, unless nothing in the signal changes at all.
 */
export async function computeNovelty(
  samples: Float32Array,
  sampleRate: number,
  control: JobControl = NO_CONTROL,
): Promise<NoveltyResult> {
  const fftSize = frameSizeFor(sampleRate);
  const hop = fftSize >> 2;
  const analyzer = new FrameAnalyzer(fftSize, "hann");
  const frames = Math.max(0, Math.floor((samples.length - fftSize) / hop) + 1);
  const novelty = new Float32Array(frames);
  const power = new Float64Array(analyzer.bins);
  const previous = new Float64Array(analyzer.bins);
  const current = new Float64Array(analyzer.bins);
  const totals = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    power.fill(0);
    analyzer.addFrame(samples, f * hop, power);
    let flux = 0;
    for (let k = 0; k < analyzer.bins; k++) {
      totals[f] += power[k];
      current[k] = Math.log1p(COMPRESSION * Math.sqrt(power[k]));
      if (f > 0 && current[k] > previous[k]) flux += current[k] - previous[k];
    }
    previous.set(current);
    novelty[f] = flux;
    if ((f & 1023) === 0) await control.checkpoint(f / Math.max(1, frames));
  }
  let max = MIN_FULL_SCALE_FLUX;
  for (let f = 1; f < frames; f++) {
    // An abrupt ending splatters energy into quiet bins, but less power follows: nothing arrived.
    const later = totals[Math.min(frames - 1, f + ARRIVAL_CHECK_FRAMES)];
    if (later < totals[f - 1] * FALLING_POWER_RATIO) novelty[f] = 0;
    if (novelty[f] > max) max = novelty[f];
  }
  for (let f = 0; f < frames; f++) novelty[f] /= max;
  return {
    novelty,
    hopSeconds: hop / sampleRate,
    // The rise is first seen when the frame's second half reaches the event.
    frameOffsetSeconds: (fftSize * 0.75) / sampleRate,
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Picks onsets from a novelty curve. A frame qualifies if it is a local maximum and stands above
 * its surroundings: both a multiple of the local mean and a fixed margin, set by sensitivity 0..1.
 * The ratio is what rejects steady noise, whose flux is high everywhere but rarely stands out.
 */
export function pickOnsets(result: NoveltyResult, sensitivity: number): OnsetPicks {
  const { novelty, hopSeconds, frameOffsetSeconds } = result;
  const n = novelty.length;
  const threshold = new Float32Array(n);
  const reach = Math.max(1, Math.round(LOCAL_SECONDS / hopSeconds));
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + novelty[i];
  const ratio = lerp(2.5, 1.2, sensitivity);
  const margin = lerp(0.12, 0.01, sensitivity);
  for (let i = 0; i < n; i++) {
    const from = Math.max(0, i - reach);
    const to = Math.min(n, i + reach + 1);
    threshold[i] = ((prefix[to] - prefix[from]) / (to - from)) * ratio + margin;
  }

  const minGap = Math.max(1, Math.round(MIN_GAP_SECONDS / hopSeconds));
  const events: OnsetEvent[] = [];
  let last = -Infinity;
  for (let i = 1; i < n - 1; i++) {
    const value = novelty[i];
    if (value < threshold[i] || value < novelty[i - 1] || value <= novelty[i + 1]) continue;
    const event = { time: Math.max(0, i * hopSeconds + frameOffsetSeconds), strength: value };
    if (i - last >= minGap) {
      events.push(event);
      last = i;
    } else if (value > events[events.length - 1].strength) {
      events[events.length - 1] = event;
      last = i;
    }
  }
  return { events, threshold };
}
