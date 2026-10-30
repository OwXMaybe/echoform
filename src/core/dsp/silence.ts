import type { JobControl, SilenceOptions, SilenceRegion, SilenceResult } from "@/types/analysis";
import { NO_CONTROL } from "@/types/analysis";
import { amplitudeToDb } from "./amplitude";

const FRAME_SECONDS = 0.01;

function regionFrom(
  channels: Float32Array[],
  sampleRate: number,
  start: number,
  end: number,
): SilenceRegion {
  let peak = 0;
  for (const channel of channels) {
    for (let i = start; i < end; i++) {
      const value = Math.abs(channel[i]);
      if (value > peak) peak = value;
    }
  }
  return {
    start: start / sampleRate,
    end: end / sampleRate,
    duration: (end - start) / sampleRate,
    peakDb: amplitudeToDb(peak),
    kind: peak === 0 ? "digital-silence" : "low-level",
  };
}

/**
 * Finds regions where every channel stays below the threshold, judged on 10 ms RMS frames.
 * Padding keeps that much audio on each side of a region, except at the ends of the recording.
 * Regions of exact zeros are digital silence; anything else is reported as low-level audio.
 */
export async function detectSilence(
  channels: Float32Array[],
  sampleRate: number,
  options: SilenceOptions,
  control: JobControl = NO_CONTROL,
): Promise<SilenceResult> {
  const length = channels[0]?.length ?? 0;
  const frameSize = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const frames = Math.ceil(length / frameSize);
  const threshold = Math.pow(10, options.thresholdDb / 20);
  const thresholdPower = threshold * threshold;
  const minSamples = Math.round(options.minDurationSeconds * sampleRate);
  const padding = Math.round(options.paddingSeconds * sampleRate);
  const regions: SilenceRegion[] = [];
  let runStart = -1;

  const closeRun = (end: number) => {
    if (end - runStart < minSamples) return;
    const start = runStart === 0 ? 0 : runStart + padding;
    const stop = end === length ? length : end - padding;
    if (stop > start) regions.push(regionFrom(channels, sampleRate, start, stop));
  };

  for (let f = 0; f < frames; f++) {
    const start = f * frameSize;
    const end = Math.min(length, start + frameSize);
    let quiet = true;
    for (const channel of channels) {
      let sum = 0;
      for (let i = start; i < end; i++) sum += channel[i] * channel[i];
      if (sum / (end - start) >= thresholdPower) {
        quiet = false;
        break;
      }
    }
    if (quiet && runStart < 0) runStart = start;
    if (!quiet && runStart >= 0) {
      closeRun(start);
      runStart = -1;
    }
    if ((f & 4095) === 0) await control.checkpoint(f / frames);
  }
  if (runStart >= 0) closeRun(length);

  const silentSeconds = regions.reduce((sum, region) => sum + region.duration, 0);
  return {
    regions,
    options,
    frameSeconds: frameSize / sampleRate,
    silentSeconds,
    ratio: length > 0 ? silentSeconds / (length / sampleRate) : 0,
  };
}
