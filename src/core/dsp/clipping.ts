import type { ClippingInterval, ClippingResult, JobControl } from "@/types/analysis";
import { NO_CONTROL } from "@/types/analysis";
import { FULL_SCALE_THRESHOLD } from "./amplitude";

/** One sample touching full scale is common in normalised audio; a flat run suggests clipping. */
export const MIN_CLIP_RUN = 3;
const MERGE_GAP_SECONDS = 0.01;
const MAX_INTERVALS = 200;

interface Run {
  start: number;
  end: number;
  channel: number;
}

async function findRuns(
  samples: Float32Array,
  channel: number,
  runs: Run[],
  control: JobControl,
): Promise<void> {
  let start = -1;
  for (let i = 0; i <= samples.length; i++) {
    const clipped =
      i < samples.length &&
      (samples[i] >= FULL_SCALE_THRESHOLD || samples[i] <= -FULL_SCALE_THRESHOLD);
    if (clipped) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= MIN_CLIP_RUN) runs.push({ start, end: i, channel });
      start = -1;
    }
    if ((i & 0xfffff) === 0) await control.checkpoint(i / samples.length);
  }
}

/** Groups runs of consecutive full-scale samples into intervals across all channels. */
export async function detectClipping(
  channels: Float32Array[],
  sampleRate: number,
  labels: string[],
  control: JobControl = NO_CONTROL,
): Promise<ClippingResult> {
  const runs: Run[] = [];
  for (let c = 0; c < channels.length; c++) await findRuns(channels[c], c, runs, control);
  runs.sort((a, b) => a.start - b.start);

  const gap = Math.round(MERGE_GAP_SECONDS * sampleRate);
  const merged: (ClippingInterval & { endSample: number })[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && run.start - last.endSample <= gap) {
      last.endSample = Math.max(last.endSample, run.end);
      last.end = last.endSample / sampleRate;
      last.clippedSamples += run.end - run.start;
      if (!last.channels.includes(labels[run.channel])) last.channels.push(labels[run.channel]);
    } else {
      merged.push({
        start: run.start / sampleRate,
        end: run.end / sampleRate,
        endSample: run.end,
        clippedSamples: run.end - run.start,
        channels: [labels[run.channel]],
      });
    }
  }
  const intervals = merged.slice(0, MAX_INTERVALS).map(
    ({ start, end, clippedSamples, channels: affected }) => ({
      start,
      end,
      clippedSamples,
      channels: affected.sort((a, b) => labels.indexOf(a) - labels.indexOf(b)),
    }),
  );
  return {
    intervals,
    totalIntervals: merged.length,
    clippedSamples: runs.reduce((sum, run) => sum + run.end - run.start, 0),
  };
}
