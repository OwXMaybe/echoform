import { describe, expect, it } from "vitest";
import { addSignals, sine, whiteNoise } from "@/core/audio/test-signals";
import { computeDescriptors } from "@/core/dsp/descriptors";
import { computeAverageSpectrum } from "@/core/dsp/spectrum";
import { FFT_SIZES, WINDOW_FUNCTIONS } from "@/types/analysis";

const RATE = 48000;
const whole = (x: Float32Array) => ({ start: 0, end: x.length });

async function describeSignal(x: Float32Array, fftSize = 2048, rolloffPercent = 85) {
  const s = await computeAverageSpectrum(x, RATE, whole(x), fftSize, "hann");
  return computeDescriptors(s.levelDb, RATE, fftSize, { windowFunction: "hann", rolloffPercent });
}

describe("spectral centroid", () => {
  it.each([440, 1000, 5000, 15000])("sits on a pure %i Hz tone", async (hz) => {
    const { centroidHz } = await describeSignal(sine(hz, 0.5, RATE, RATE));
    expect(Math.abs(centroidHz! - hz)).toBeLessThan(30);
  });

  it("is the amplitude-weighted mean of two tones", async () => {
    const x = addSignals(sine(1000, 0.75, RATE, RATE), sine(3000, 0.25, RATE, RATE));
    const { centroidHz } = await describeSignal(x, 8192);
    expect(Math.abs(centroidHz! - 1500)).toBeLessThan(30);
  });

  it("does not depend on gain", async () => {
    const quiet = await describeSignal(sine(2000, 0.01, RATE, RATE));
    const loud = await describeSignal(sine(2000, 0.9, RATE, RATE));
    expect(quiet.centroidHz!).toBeCloseTo(loud.centroidHz!, 0);
  });

  it("ignores DC offset", async () => {
    const clean = await describeSignal(sine(4000, 0.25, RATE, RATE));
    const offset = await describeSignal(sine(4000, 0.25, RATE, RATE).map((v) => v + 0.3));
    expect(Math.abs(offset.centroidHz! - clean.centroidHz!)).toBeLessThan(20);
  });

  it("sits mid-band for white noise", async () => {
    const { centroidHz } = await describeSignal(whiteNoise(0.5, RATE * 10));
    expect(Math.abs(centroidHz! - RATE / 4)).toBeLessThan(200);
  });
});

describe("spectral rolloff", () => {
  it("sits on a pure tone", async () => {
    const { rolloffHz } = await describeSignal(sine(3000, 0.5, RATE, RATE));
    expect(Math.abs(rolloffHz! - 3000)).toBeLessThan(50);
  });

  it("moves between tones with the chosen percentage", async () => {
    // Power is split 80/20 between the tones.
    const x = addSignals(sine(1000, 0.8, RATE, RATE), sine(5000, 0.4, RATE, RATE));
    const low = await describeSignal(x, 4096, 50);
    const high = await describeSignal(x, 4096, 95);
    expect(Math.abs(low.rolloffHz! - 1000)).toBeLessThan(50);
    expect(Math.abs(high.rolloffHz! - 5000)).toBeLessThan(50);
  });

  it("matches the percentage on white noise", async () => {
    const { rolloffHz } = await describeSignal(whiteNoise(0.5, RATE * 10), 2048, 75);
    expect(Math.abs(rolloffHz! - 0.75 * (RATE / 2))).toBeLessThan(200);
  });
});

describe("spectral flatness", () => {
  it("approaches 1 for averaged white noise", async () => {
    const { flatness } = await describeSignal(whiteNoise(0.5, RATE * 20), 1024);
    expect(flatness!).toBeGreaterThan(0.95);
    expect(flatness!).toBeLessThanOrEqual(1);
  });

  it("is near 0 for a pure tone", async () => {
    const { flatness, flatnessDb } = await describeSignal(sine(1000, 0.5, RATE, RATE));
    expect(flatness!).toBeLessThan(0.01);
    expect(flatnessDb!).toBeLessThan(-20);
  });

  it("orders tone, tone plus noise and noise", async () => {
    const tone = sine(1000, 0.5, RATE, RATE * 5);
    const noise = whiteNoise(0.05, RATE * 5);
    const a = await describeSignal(tone);
    const b = await describeSignal(addSignals(tone, noise));
    const c = await describeSignal(noise);
    expect(a.flatness!).toBeLessThan(b.flatness!);
    expect(b.flatness!).toBeLessThan(c.flatness!);
  });
});

describe("edge cases", () => {
  it("returns nulls, never NaN, for silence", async () => {
    expect(await describeSignal(new Float32Array(RATE))).toEqual({
      centroidHz: null,
      rolloffHz: null,
      flatness: null,
      flatnessDb: null,
    });
  });

  it("returns finite values at every FFT size and window", async () => {
    const x = sine(1234, 0.5, RATE, RATE);
    for (const size of FFT_SIZES) {
      for (const win of WINDOW_FUNCTIONS) {
        const s = await computeAverageSpectrum(x, RATE, whole(x), size, win);
        const d = computeDescriptors(s.levelDb, RATE, size, { windowFunction: win, rolloffPercent: 85 });
        expect(Number.isFinite(d.centroidHz)).toBe(true);
        expect(Number.isFinite(d.flatness)).toBe(true);
      }
    }
  });

  it("analyses only the requested band", async () => {
    const x = addSignals(sine(1000, 0.5, RATE, RATE), sine(9000, 0.5, RATE, RATE));
    const s = await computeAverageSpectrum(x, RATE, whole(x), 4096, "hann");
    const d = computeDescriptors(s.levelDb, RATE, 4096, {
      windowFunction: "hann",
      rolloffPercent: 85,
      minHz: 5000,
      maxHz: 15000,
    });
    expect(Math.abs(d.centroidHz! - 9000)).toBeLessThan(50);
  });

  it("returns nulls for a band narrower than one bin", async () => {
    const x = sine(1000, 0.5, RATE, RATE);
    const s = await computeAverageSpectrum(x, RATE, whole(x), 256, "hann");
    const d = computeDescriptors(s.levelDb, RATE, 256, {
      windowFunction: "hann",
      rolloffPercent: 85,
      minHz: 1001,
      maxHz: 1002,
    });
    expect(d.centroidHz).toBeNull();
  });
});
