import { describe, expect, it } from "vitest";
import { sine, sweep, whiteNoise } from "@/core/audio/test-signals";
import {
  estimateOffset,
  logFrequencyGrid,
  spectrumOnGrid,
  waveformDifference,
  waveformEnvelope,
  zeroCrossingRate,
} from "@/core/dsp/comparison";
import { computeAverageSpectrum } from "@/core/dsp/spectrum";

const RATE = 48000;

describe("zero-crossing rate", () => {
  it.each([100, 1000, 5000])("is twice the frequency of a %i Hz sine", (hz) => {
    expect(zeroCrossingRate(sine(hz, 0.5, RATE, RATE, 0.3), RATE)!).toBeCloseTo(2 * hz, -1);
  });

  it("is zero for a constant signal", () => {
    expect(zeroCrossingRate(new Float32Array(100).fill(0.5), RATE)).toBe(0);
  });

  it("counts one crossing through a run of zeros", () => {
    expect(zeroCrossingRate(Float32Array.of(1, 0, 0, -1), 4)).toBe(1);
  });

  it("is undefined for fewer than two samples", () => {
    expect(zeroCrossingRate(new Float32Array(1), RATE)).toBeNull();
  });

  it("honours the range", () => {
    const x = sine(1000, 0.5, RATE, RATE, 0.3);
    x.fill(0, 0, RATE / 2);
    const rate = zeroCrossingRate(x, RATE, { start: RATE / 2, end: RATE })!;
    expect(rate).toBeCloseTo(2000, -1);
  });
});

describe("spectrum grids", () => {
  it("spans the requested range logarithmically", () => {
    const grid = logFrequencyGrid(20, 20000, 4);
    expect(grid[0]).toBeCloseTo(20, 3);
    expect(grid[1]).toBeCloseTo(200, 1);
    expect(grid[3]).toBeCloseTo(20000, 0);
  });

  it("keeps the level of noise, which is flat, on wide high-frequency steps", async () => {
    const x = whiteNoise(0.5, RATE * 4);
    const fft = 1024;
    const s = await computeAverageSpectrum(x, RATE, { start: 0, end: x.length }, fft, "hann");
    const out = spectrumOnGrid(s.levelDb, RATE, fft, logFrequencyGrid(200, 20000, 100));
    const expected = s.levelDb[Math.round((5000 * fft) / RATE)];
    for (let g = 20; g < 95; g++) expect(Math.abs(out[g] - expected)).toBeLessThan(3);
  });

  it("puts a tone at the same grid point for two sample rates", async () => {
    const grid = logFrequencyGrid(20, 20000, 400);
    const peakOf = async (rate: number) => {
      const x = sine(1000, 0.5, rate, rate * 2);
      const s = await computeAverageSpectrum(x, rate, { start: 0, end: x.length }, 8192, "hann");
      const level = spectrumOnGrid(s.levelDb, rate, 8192, grid);
      return { hz: grid[level.indexOf(Math.max(...level))], db: Math.max(...level) };
    };
    const a = await peakOf(44100);
    const b = await peakOf(96000);
    expect(Math.abs(a.hz - 1000)).toBeLessThan(15);
    expect(Math.abs(b.hz - 1000)).toBeLessThan(15);
    // Band averaging lowers a tone by an amount that depends on the bins per band.
    expect(Math.abs(a.db - b.db)).toBeLessThan(2.5);
  });
});

describe("waveform envelopes", () => {
  it("reports each column's extremes", () => {
    const { min, max } = waveformEnvelope(
      Float32Array.of(0, 1, -1, 0.5),
      { start: 0, end: 4 },
      2,
    );
    expect(Array.from(max)).toEqual([1, 0.5]);
    expect(Array.from(min)).toEqual([0, -1]);
  });

  it("applies gain", () => {
    const { max } = waveformEnvelope(Float32Array.of(0.5), { start: 0, end: 1 }, 1, 2);
    expect(max[0]).toBe(1);
  });

  it("does not leave gaps when columns outnumber samples", () => {
    const { max } = waveformEnvelope(Float32Array.of(0.5, 0.25), { start: 0, end: 2 }, 4);
    expect(Array.from(max)).toEqual([0.5, 0.5, 0.25, 0.25]);
  });
});

describe("waveform difference", () => {
  it("is empty for identical signals", async () => {
    const x = sine(1000, 0.5, RATE, RATE);
    const { rmsDb } = await waveformDifference(x, { start: 0, end: RATE }, x, 0, 1, 100);
    expect(rmsDb).toBeNull();
  });

  it("measures a known gain error", async () => {
    const a = sine(1000, 0.5, RATE, RATE);
    const b = sine(1000, 0.25, RATE, RATE);
    const { rmsDb } = await waveformDifference(a, { start: 0, end: RATE }, b, 0, 1, 100);
    expect(rmsDb!).toBeCloseTo(20 * Math.log10(0.25) - 3.01, 2);
  });

  it("cancels once gain and alignment are right", async () => {
    const a = whiteNoise(0.5, RATE);
    const b = a.slice(1000).map((v) => v / 2);
    const { rmsDb } = await waveformDifference(a, { start: 1000, end: RATE }, b, 0, 2, 100);
    expect(rmsDb === null || rmsDb < -130).toBe(true);
  });

  it("subtracts in the direction A minus B", async () => {
    const a = new Float32Array(10).fill(0.5);
    const b = new Float32Array(10).fill(0.25);
    const { envelope } = await waveformDifference(a, { start: 0, end: 10 }, b, 0, 1, 1);
    expect(envelope.max[0]).toBeCloseTo(0.25, 6);
  });
});

describe("offset estimation", () => {
  const material = whiteNoise(0.5, RATE * 2, 4242);

  it.each([1000, 12345, 30001])("finds a B that starts %i samples into A", async (lag) => {
    const b = material.slice(lag);
    const estimate = await estimateOffset(material, RATE, b, RATE);
    expect(Math.round(estimate.offsetSeconds * RATE)).toBe(lag);
    expect(estimate.coefficient!).toBeGreaterThan(0.99);
    expect(estimate.resolutionSeconds).toBeCloseTo(1 / RATE, 8);
  });

  it("finds a negative offset when A starts inside B", async () => {
    const a = material.slice(9000);
    const estimate = await estimateOffset(a, RATE, material, RATE);
    expect(Math.round(estimate.offsetSeconds * RATE)).toBe(-9000);
  });

  it("is not fooled by a gain difference", async () => {
    const b = material.slice(5000).map((v) => v * 0.1);
    const estimate = await estimateOffset(material, RATE, b, RATE);
    expect(Math.round(estimate.offsetSeconds * RATE)).toBe(5000);
  });

  it("gives a low coefficient for unrelated recordings", async () => {
    const other = whiteNoise(0.5, RATE * 2, 777);
    const { coefficient } = await estimateOffset(material, RATE, other, RATE);
    expect(Math.abs(coefficient!)).toBeLessThan(0.3);
  });

  it("works across sample rates at the coarser resolution", async () => {
    const a = sweep(100, 1800, 0.5, RATE, RATE * 2);
    const rateB = 44100;
    const delay = 0.25;
    const b = new Float32Array(Math.floor(rateB * 1.5));
    for (let n = 0; n < b.length; n++) {
      const t = n / rateB + delay;
      const f0 = 100;
      const slope = (1800 - 100) / 2;
      b[n] = 0.5 * Math.sin(2 * Math.PI * (f0 * t + 0.5 * slope * t * t));
    }
    const estimate = await estimateOffset(a, RATE, b, rateB);
    expect(estimate.resolutionSeconds).toBeCloseTo(1 / 4000, 6);
    expect(Math.abs(estimate.offsetSeconds - delay)).toBeLessThan(0.002);
  });

  it("gives no coefficient for digital silence", async () => {
    const { coefficient } = await estimateOffset(
      new Float32Array(RATE),
      RATE,
      new Float32Array(RATE),
      RATE,
    );
    expect(coefficient).toBeNull();
  });
});
