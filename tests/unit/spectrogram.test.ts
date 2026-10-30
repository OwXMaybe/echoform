import { describe, expect, it } from "vitest";
import { measureRegion } from "@/core/analysis/region";
import { addSignals, sine, sweep } from "@/core/audio/test-signals";
import { measureAmplitude } from "@/core/dsp/amplitude";
import { computeSpectrogram, spectrogramColumnAt } from "@/core/dsp/stft";
import { WINDOW_FUNCTIONS } from "@/types/analysis";

const RATE = 48000;

function peakBin(g: Awaited<ReturnType<typeof computeSpectrogram>>, column: number): number {
  let best = 0;
  for (let k = 1; k < g.bins; k++) {
    if (g.data[column * g.bins + k] > g.data[column * g.bins + best]) best = k;
  }
  return best;
}

describe("ranged spectrogram", () => {
  const x = sweep(1000, 9000, 0.5, RATE, RATE * 8);
  const range = { start: RATE * 4, end: RATE * 5 };

  it("reports its own time origin", async () => {
    const g = await computeSpectrogram(x, RATE, 2048, 512, "hann", undefined, undefined, range);
    expect(g.startSeconds).toBe(4);
    expect(g.columns).toBe(Math.floor(RATE / 512) + 1);
  });

  it("agrees with the full spectrogram at the same time", async () => {
    const full = await computeSpectrogram(x, RATE, 2048, 512, "hann");
    const part = await computeSpectrogram(x, RATE, 2048, 512, "hann", undefined, undefined, range);
    const a = spectrogramColumnAt(full, 4.5);
    const b = spectrogramColumnAt(part, 4.5);
    expect(peakBin(part, b)).toBe(peakBin(full, a));
    expect(part.data[b * part.bins + 200]).toBeCloseTo(full.data[a * full.bins + 200], 3);
  });

  it("uses real samples at its edges instead of zeros", async () => {
    const tone = sine((64 * RATE) / 2048, 0.5, RATE, RATE * 2);
    const r = { start: RATE / 2, end: RATE };
    const g = await computeSpectrogram(tone, RATE, 2048, 512, "hann", undefined, undefined, r);
    expect(g.data[64]).toBeCloseTo(20 * Math.log10(0.5), 2);
  });

  it("clamps out-of-range times to its own columns", async () => {
    const g = await computeSpectrogram(x, RATE, 2048, 512, "hann", undefined, undefined, range);
    expect(spectrogramColumnAt(g, 0)).toBe(0);
    expect(spectrogramColumnAt(g, 100)).toBe(g.columns - 1);
  });

  it("gains time resolution over a memory-capped overview", async () => {
    const cap = 100_000;
    const coarse = await computeSpectrogram(x, RATE, 1024, 256, "hann", undefined, cap);
    const fine = await computeSpectrogram(x, RATE, 1024, 256, "hann", undefined, cap, range);
    expect(coarse.framesPerColumn).toBeGreaterThan(1);
    expect(fine.framesPerColumn).toBeLessThan(coarse.framesPerColumn);
  });
});

describe("region measurement", () => {
  it.each(WINDOW_FUNCTIONS)("matches time-domain RMS for a tone with a %s window", async (win) => {
    const hz = (100 * RATE) / 4096;
    const x = sine(hz, 0.5, RATE, RATE * 2);
    const g = await computeSpectrogram(x, RATE, 4096, 1024, win);
    const m = measureRegion(g, {
      startSeconds: 0.5,
      endSeconds: 1.5,
      minHz: hz - 500,
      maxHz: hz + 500,
    });
    expect(m.bandLevelDb!).toBeCloseTo(measureAmplitude(x).rmsDbfs!, 1);
  });

  it("isolates one of two tones by frequency", async () => {
    const x = addSignals(sine(1000, 0.5, RATE, RATE), sine(5000, 0.05, RATE, RATE));
    const g = await computeSpectrogram(x, RATE, 2048, 512, "hann");
    const m = measureRegion(g, { startSeconds: 0.2, endSeconds: 0.8, minHz: 4000, maxHz: 6000 });
    expect(m.bandLevelDb!).toBeCloseTo(20 * Math.log10(0.05 / Math.SQRT2), 0);
    expect(Math.abs(m.peakHz - 5000)).toBeLessThan(30);
  });

  it("locates the peak in time and frequency", async () => {
    const x = sweep(1000, 9000, 0.5, RATE, RATE * 2);
    const g = await computeSpectrogram(x, RATE, 2048, 256, "hann");
    const m = measureRegion(g, { startSeconds: 0.9, endSeconds: 1.1, minHz: 4900, maxHz: 5100 });
    expect(Math.abs(m.peakSeconds - 1)).toBeLessThan(0.05);
    expect(Math.abs(m.peakHz - 5000)).toBeLessThan(100);
  });

  it("reports no level for silence", async () => {
    const g = await computeSpectrogram(new Float32Array(RATE), RATE, 1024, 512, "hann");
    const m = measureRegion(g, { startSeconds: 0.1, endSeconds: 0.5, minHz: 100, maxHz: 1000 });
    expect(m.bandLevelDb).toBeNull();
    expect(m.peakDb).toBeNull();
  });

  it("works on a ranged spectrogram", async () => {
    const x = sine(1000, 0.5, RATE, RATE * 3);
    const range = { start: RATE, end: RATE * 2 };
    const g = await computeSpectrogram(x, RATE, 2048, 512, "hann", undefined, undefined, range);
    const m = measureRegion(g, { startSeconds: 1.2, endSeconds: 1.8, minHz: 800, maxHz: 1200 });
    expect(m.peakSeconds).toBeGreaterThanOrEqual(1.19);
    expect(m.peakSeconds).toBeLessThanOrEqual(1.81);
  });
});
