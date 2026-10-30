import { describe, expect, it } from "vitest";
import { sine, whiteNoise } from "@/core/audio/test-signals";
import { analyseStereo, sideSignal, VECTORSCOPE_SIZE } from "@/core/dsp/stereo";

const RATE = 48000;
const tone = (amplitude = 0.5) => sine(1000, amplitude, RATE, RATE);
const negate = (x: Float32Array) => x.map((v) => -v);
const db = (x: number) => 20 * Math.log10(x);

describe("stereo levels", () => {
  it("measures each channel's RMS and peak", async () => {
    const result = await analyseStereo(tone(0.5), tone(0.25), RATE);
    expect(result.leftPeakDb!).toBeCloseTo(db(0.5), 2);
    expect(result.rightPeakDb!).toBeCloseTo(db(0.25), 2);
    expect(result.leftRmsDb!).toBeCloseTo(db(0.5) - 3.01, 2);
    expect(result.rightRmsDb!).toBeCloseTo(db(0.25) - 3.01, 2);
  });

  it("reports left minus right as the level difference", async () => {
    const result = await analyseStereo(tone(0.5), tone(0.25), RATE);
    expect(result.levelDifferenceDb!).toBeCloseTo(6.02, 2);
    const swapped = await analyseStereo(tone(0.25), tone(0.5), RATE);
    expect(swapped.levelDifferenceDb!).toBeCloseTo(-6.02, 2);
  });
});

describe("channel correlation", () => {
  it("is +1 for identical channels, whatever the gain", async () => {
    expect((await analyseStereo(tone(), tone(), RATE)).correlation!).toBeCloseTo(1, 6);
    expect((await analyseStereo(tone(0.5), tone(0.1), RATE)).correlation!).toBeCloseTo(1, 6);
  });

  it("is -1 for inverted channels", async () => {
    const x = tone();
    expect((await analyseStereo(x, negate(x), RATE)).correlation!).toBeCloseTo(-1, 6);
  });

  it("is 0 for tones in quadrature", async () => {
    const quadrature = sine(1000, 0.5, RATE, RATE, Math.PI / 2);
    expect(Math.abs((await analyseStereo(tone(), quadrature, RATE)).correlation!)).toBeLessThan(1e-4);
  });

  it("is near 0 for independent noise", async () => {
    const left = whiteNoise(0.5, RATE, 1234);
    const right = whiteNoise(0.5, RATE, 987654);
    expect(Math.abs((await analyseStereo(left, right, RATE)).correlation!)).toBeLessThan(0.02);
  });

  it("is undefined, not zero, when a channel is silent", async () => {
    const result = await analyseStereo(tone(), new Float32Array(RATE), RATE);
    expect(result.correlation).toBeNull();
    expect(result.levelDifferenceDb).toBeNull();
  });

  it("tracks a relationship that changes over time", async () => {
    const x = tone();
    const y = x.slice();
    y.set(negate(x.subarray(RATE / 2)), RATE / 2);
    const { correlationOverTime: series, correlation } = await analyseStereo(x, y, RATE);
    expect(series.length).toBe(10);
    expect(series[1]).toBeCloseTo(1, 4);
    expect(series[8]).toBeCloseTo(-1, 4);
    expect(Math.abs(correlation!)).toBeLessThan(0.01);
  });

  it("marks silent blocks as undefined", async () => {
    const x = tone();
    x.fill(0, 0, RATE / 2);
    const { correlationOverTime: series } = await analyseStereo(x, x, RATE);
    expect(Number.isNaN(series[0])).toBe(true);
    expect(series[9]).toBeCloseTo(1, 4);
  });
});

describe("mid and side", () => {
  it("puts identical channels entirely in the mid", async () => {
    const result = await analyseStereo(tone(), tone(), RATE);
    expect(result.midRmsDb!).toBeCloseTo(result.leftRmsDb!, 3);
    expect(result.sideRmsDb).toBeNull();
    expect(result.width).toBe(0);
  });

  it("puts inverted channels entirely in the side", async () => {
    const x = tone();
    const result = await analyseStereo(x, negate(x), RATE);
    expect(result.sideRmsDb!).toBeCloseTo(result.leftRmsDb!, 3);
    expect(result.midRmsDb).toBeNull();
    expect(result.width).toBeCloseTo(1, 6);
  });

  it("uses Mid = (L + R) / 2 and Side = (L - R) / 2", async () => {
    // L = 0.6 s, R = 0.2 s gives M = 0.4 s, S = 0.2 s.
    const result = await analyseStereo(tone(0.6), tone(0.2), RATE);
    expect(result.midPeakDb!).toBeCloseTo(db(0.4), 2);
    expect(result.sidePeakDb!).toBeCloseTo(db(0.2), 2);
    expect(result.sideToMidDb!).toBeCloseTo(-6.02, 2);
    expect(result.width!).toBeCloseTo(0.2, 3);
  });

  it("reports a width near one half for uncorrelated channels", async () => {
    const left = whiteNoise(0.5, RATE, 1234);
    const right = whiteNoise(0.5, RATE, 987654);
    expect((await analyseStereo(left, right, RATE)).width!).toBeCloseTo(0.5, 1);
  });

  it("derives the side signal sample by sample", () => {
    const side = sideSignal(Float32Array.of(1, 0.5), Float32Array.of(-1, 0.5));
    expect(Array.from(side)).toEqual([1, 0]);
  });
});

describe("stereo scope", () => {
  it("honours the sample range", async () => {
    const left = tone();
    left.fill(0, RATE / 2);
    const right = tone();
    const result = await analyseStereo(left, right, RATE, { start: RATE / 2, end: RATE });
    expect(result.sampleCount).toBe(RATE / 2);
    expect(result.leftRmsDb).toBeNull();
  });

  it("counts every in-range sample in the vectorscope", async () => {
    const { vectorscope, sampleCount } = await analyseStereo(tone(), tone(), RATE);
    expect(vectorscope.length).toBe(VECTORSCOPE_SIZE ** 2);
    expect(vectorscope.reduce((a, b) => a + b, 0)).toBe(sampleCount);
  });

  it("places a mono signal on the centre column", async () => {
    const { vectorscope, vectorscopeSize: size } = await analyseStereo(tone(), tone(), RATE);
    const centre = Math.floor(size / 2);
    let off = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) if (x !== centre) off += vectorscope[y * size + x];
    }
    expect(off).toBe(0);
  });
});
