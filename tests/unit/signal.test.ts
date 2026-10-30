import { describe, expect, it } from "vitest";
import { createDemoSignal, sine, whiteNoise } from "@/core/audio/test-signals";
import { detectClipping, MIN_CLIP_RUN } from "@/core/dsp/clipping";
import { analyseDynamics, sampleHistogram, shortTermLevels } from "@/core/dsp/dynamics";
import { detectSilence } from "@/core/dsp/silence";

const RATE = 48000;
const defaults = { thresholdDb: -60, minDurationSeconds: 0.5, paddingSeconds: 0 };

function withGap(start: number, end: number, gapLevel = 0): Float32Array {
  const x = sine(1000, 0.5, RATE, RATE * 3);
  for (let i = start * RATE; i < end * RATE; i++) x[i] = gapLevel;
  return x;
}

describe("silence detection", () => {
  it("finds a digital-silence gap at the right place", async () => {
    const { regions, ratio, silentSeconds } = await detectSilence([withGap(1, 2)], RATE, defaults);
    expect(regions).toHaveLength(1);
    expect(regions[0].start).toBeCloseTo(1, 1);
    expect(regions[0].end).toBeCloseTo(2, 1);
    expect(regions[0].kind).toBe("digital-silence");
    expect(regions[0].peakDb).toBeNull();
    expect(silentSeconds).toBeCloseTo(1, 1);
    expect(ratio).toBeCloseTo(1 / 3, 1);
  });

  it("labels a quiet passage as low-level audio, not silence", async () => {
    const x = withGap(1, 2, 0.0001);
    const [region] = (await detectSilence([x], RATE, defaults)).regions;
    expect(region.kind).toBe("low-level");
    expect(region.peakDb).toBeCloseTo(-80, 1);
  });

  it("honours the threshold", async () => {
    const x = withGap(1, 2, 0.0001);
    const low = await detectSilence([x], RATE, { ...defaults, thresholdDb: -90 });
    expect(low.regions).toHaveLength(0);
  });

  it("ignores gaps shorter than the minimum duration", async () => {
    const short = await detectSilence([withGap(1, 1.2)], RATE, defaults);
    expect(short.regions).toHaveLength(0);
  });

  it("applies padding inside the recording but not at its ends", async () => {
    const x = withGap(1, 2);
    x.fill(0, RATE * 2.5);
    const { regions } = await detectSilence([x], RATE, { ...defaults, paddingSeconds: 0.1 });
    expect(regions).toHaveLength(2);
    expect(regions[0].start).toBeCloseTo(1.1, 1);
    expect(regions[0].end).toBeCloseTo(1.9, 1);
    expect(regions[1].end).toBe(3);
  });

  it("requires every channel to be quiet", async () => {
    const left = withGap(1, 2);
    const right = sine(500, 0.5, RATE, RATE * 3);
    const { regions } = await detectSilence([left, right], RATE, defaults);
    expect(regions).toHaveLength(0);
  });

  it("treats a fully silent recording as one region", async () => {
    const { regions, ratio } = await detectSilence([new Float32Array(RATE)], RATE, defaults);
    expect(regions).toHaveLength(1);
    expect(ratio).toBe(1);
  });

  it("finds the demo signal's final second", async () => {
    const demo = createDemoSignal();
    const { regions } = await detectSilence(demo.channels, demo.sampleRate, defaults);
    expect(regions).toHaveLength(1);
    expect(regions[0].start).toBeCloseTo(5, 1);
    expect(regions[0].end).toBe(6);
  });
});

describe("clipping intervals", () => {
  const clipped = (gain: number, length = RATE) =>
    sine(1000, gain, RATE, length).map((v) => Math.max(-1, Math.min(1, v)));

  it("reports flat-topped runs as one interval with their channels", async () => {
    const x = new Float32Array(RATE);
    x.set(clipped(2, 4800), 24000);
    const result = await detectClipping([x, new Float32Array(RATE)], RATE, ["Left", "Right"]);
    expect(result.intervals).toHaveLength(1);
    expect(result.intervals[0].start).toBeCloseTo(0.5, 2);
    expect(result.intervals[0].end).toBeCloseTo(0.6, 2);
    expect(result.intervals[0].channels).toEqual(["Left"]);
    expect(result.clippedSamples).toBeGreaterThan(1000);
  });

  it("lists every affected channel", async () => {
    const x = clipped(2);
    const result = await detectClipping([x, x], RATE, ["Left", "Right"]);
    expect(result.intervals[0].channels).toEqual(["Left", "Right"]);
  });

  it("does not call isolated full-scale samples clipping", async () => {
    const x = new Float32Array(RATE);
    x[100] = 1;
    x[5000] = -1;
    for (let i = 0; i < MIN_CLIP_RUN - 1; i++) x[9000 + i] = 1;
    expect((await detectClipping([x], RATE, ["Mono"])).totalIntervals).toBe(0);
  });

  it("finds nothing in a clean signal", async () => {
    const result = await detectClipping([sine(1000, 0.99, RATE, RATE)], RATE, ["Mono"]);
    expect(result.totalIntervals).toBe(0);
    expect(result.clippedSamples).toBe(0);
  });

  it("caps the list but keeps the true total", async () => {
    const x = new Float32Array(RATE * 60);
    for (let n = 0; n < 500; n++) x.fill(1, n * 4800, n * 4800 + 5);
    const result = await detectClipping([x], RATE, ["Mono"]);
    expect(result.intervals).toHaveLength(200);
    expect(result.totalIntervals).toBe(500);
    expect(result.clippedSamples).toBe(2500);
  });
});

describe("sample histogram", () => {
  it("accounts for every sample", () => {
    const x = whiteNoise(1, 10000);
    const total = sampleHistogram(x).counts.reduce((a, b) => a + b, 0);
    expect(total).toBe(10000);
  });

  it("puts silence in the centre bin", () => {
    const { counts } = sampleHistogram(new Float32Array(1000));
    expect(counts[50]).toBe(1000);
  });

  it("shows uniform noise as flat", () => {
    const { counts } = sampleHistogram(whiteNoise(1, 1_010_000));
    expect(Math.max(...counts) / Math.min(...counts)).toBeLessThan(1.1);
  });

  it("shows a sine as peaked at its extremes", () => {
    const { counts } = sampleHistogram(sine(997, 0.9, RATE, RATE));
    expect(counts[5]).toBeGreaterThan(counts[50] * 3);
  });

  it("flags and retains over-range samples", () => {
    const { counts, overRange } = sampleHistogram(new Float32Array([1.5, -2, 0]));
    expect(overRange).toBe(2);
    expect(counts[100]).toBe(1);
    expect(counts[0]).toBe(1);
  });

  it("respects a range", () => {
    const x = new Float32Array(100).fill(0.5);
    const total = sampleHistogram(x, { start: 10, end: 20 }).counts.reduce((a, b) => a + b, 0);
    expect(total).toBe(10);
  });
});

describe("short-term dynamics", () => {
  const block = RATE / 10;

  it("measures a constant tone as having no range", async () => {
    const levels = await shortTermLevels(sine(1000, 0.5, RATE, RATE * 5), block);
    const d = analyseDynamics(levels);
    expect(levels).toHaveLength(50);
    expect(d.p50Db!).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 1);
    expect(d.rangeDb!).toBeCloseTo(0, 1);
  });

  it("measures the step between two levels", async () => {
    const x = sine(1000, 0.5, RATE, RATE * 4);
    for (let i = RATE * 2; i < x.length; i++) x[i] *= 0.1;
    const d = analyseDynamics(await shortTermLevels(x, block));
    expect(d.rangeDb!).toBeCloseTo(20, 0);
  });

  it("gates silence out of the statistics but counts the blocks", async () => {
    const x = sine(1000, 0.5, RATE, RATE * 2);
    x.fill(0, RATE);
    const d = analyseDynamics(await shortTermLevels(x, block));
    expect(d.blocks).toBe(20);
    expect(d.gatedBlocks).toBe(10);
    expect(d.rangeDb!).toBeCloseTo(0, 1);
  });

  it("returns null statistics for silence", async () => {
    const d = analyseDynamics(await shortTermLevels(new Float32Array(RATE), block));
    expect(d.gatedBlocks).toBe(0);
    expect(d.rangeDb).toBeNull();
    expect(d.p50Db).toBeNull();
  });

  it("handles a range shorter than one block", async () => {
    const levels = await shortTermLevels(new Float32Array(RATE), block, { start: 0, end: 100 });
    expect(levels).toHaveLength(0);
    expect(analyseDynamics(levels).rangeDb).toBeNull();
  });

  it("places blocks in the histogram", async () => {
    const levels = await shortTermLevels(sine(1000, 0.5, RATE, RATE), block);
    const { counts, minDb, binDb } = analyseDynamics(levels).histogram;
    const bin = counts.findIndex((c) => c === 10);
    expect(minDb + bin * binDb).toBeLessThanOrEqual(-9.03);
    expect(minDb + (bin + 1) * binDb).toBeGreaterThan(-9.03);
  });
});
