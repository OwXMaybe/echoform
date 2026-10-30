import { describe, expect, it } from "vitest";
import { amplitudeToDb, measureAmplitude } from "@/core/dsp/amplitude";
import { FFT } from "@/core/dsp/fft";
import { DEFAULT_PEAK_OPTIONS, detectPeaks, frequencyBand } from "@/core/dsp/peaks";
import { computeAverageSpectrum, DB_FLOOR, FrameAnalyzer } from "@/core/dsp/spectrum";
import { computeSpectrogram, spectrogramColumnAt } from "@/core/dsp/stft";
import { buildWaveformPyramid, selectLevel } from "@/core/dsp/waveform";
import { createWindow, windowProperties } from "@/core/dsp/windows";
import { addSignals, sine, sweep, whiteNoise } from "@/core/audio/test-signals";
import { FFT_SIZES, WINDOW_FUNCTIONS } from "@/types/analysis";

const whole = (x: Float32Array) => ({ start: 0, end: x.length });

describe("FFT", () => {
  it("matches a naive DFT", () => {
    const n = 32;
    const input = Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1));
    const re = Float64Array.from(input);
    const im = new Float64Array(n);
    new FFT(n).transform(re, im);
    for (let k = 0; k < n; k++) {
      let dr = 0;
      let di = 0;
      for (let t = 0; t < n; t++) {
        dr += input[t] * Math.cos((-2 * Math.PI * k * t) / n);
        di += input[t] * Math.sin((-2 * Math.PI * k * t) / n);
      }
      expect(re[k]).toBeCloseTo(dr, 9);
      expect(im[k]).toBeCloseTo(di, 9);
    }
  });

  it("satisfies Parseval's theorem", () => {
    const n = 4096;
    const noise = whiteNoise(1, n);
    const re = Float64Array.from(noise);
    const im = new Float64Array(n);
    const time = re.reduce((s, x) => s + x * x, 0);
    new FFT(n).transform(re, im);
    let frequency = 0;
    for (let k = 0; k < n; k++) frequency += re[k] * re[k] + im[k] * im[k];
    expect(frequency / n).toBeCloseTo(time, 6);
  });

  it("rejects sizes that are not powers of two", () => {
    expect(() => new FFT(1000)).toThrow(RangeError);
  });
});

describe("window functions", () => {
  it("has the textbook coherent gain and ENBW", () => {
    const expected = {
      rectangular: [1, 1],
      hann: [0.5, 1.5],
      hamming: [0.54, 1.3628],
      blackman: [0.42, 1.7268],
    } as const;
    for (const type of WINDOW_FUNCTIONS) {
      const p = windowProperties(createWindow(type, 4096));
      expect(p.coherentGain).toBeCloseTo(expected[type][0], 6);
      expect(p.enbwBins).toBeCloseTo(expected[type][1], 3);
    }
  });
});

describe("test signal 1: pure sine", () => {
  it.each([
    [44100, 1000],
    [48000, 997],
    [96000, 12345],
    [8000, 440],
  ])("measures peak and RMS at %i Hz sample rate", (rate, freq) => {
    const m = measureAmplitude(sine(freq, 0.5, rate, rate));
    expect(m.peak).toBeCloseTo(0.5, 2);
    expect(m.rms).toBeCloseTo(0.5 / Math.SQRT2, 3);
    expect(m.rmsDbfs!).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 2);
    expect(m.crestFactor!).toBeCloseTo(Math.SQRT2, 2);
  });

  it.each(
    FFT_SIZES.flatMap((size) => WINDOW_FUNCTIONS.map((w) => [size, w] as const)),
  )("calibrates a bin-centred tone at FFT %i / %s to its true amplitude", async (size, win) => {
    const rate = 48000;
    const bin = size / 8;
    const x = sine((bin * rate) / size, 0.25, rate, size * 8);
    const s = await computeAverageSpectrum(x, rate, whole(x), size, win);
    expect(s.levelDb[bin]).toBeCloseTo(20 * Math.log10(0.25), 3);
    expect(s.frequencyResolution).toBe(rate / size);
    expect(s.levelDb.length).toBe(size / 2 + 1);
  });

  it("reads a full-scale sine as 0 dB in the spectrum and -3.01 dB as RMS", async () => {
    const x = sine(1500, 1, 48000, 48000);
    const s = await computeAverageSpectrum(x, 48000, whole(x), 2048, "hann");
    expect(s.levelDb[Math.round((1500 * 2048) / 48000)]).toBeGreaterThan(-1.6);
    expect(measureAmplitude(x).rmsDbfs!).toBeCloseTo(-3.01, 1);
  });

  it.each([256, 1024, 4096, 16384])(
    "locates an off-bin tone within a fraction of a bin at FFT %i",
    async (size) => {
      const rate = 44100;
      const freq = 3217.3;
      const x = sine(freq, 0.5, rate, Math.max(rate, size * 4));
      const s = await computeAverageSpectrum(x, rate, whole(x), size, "hann");
      const [peak] = detectPeaks(s.levelDb, rate, size, DEFAULT_PEAK_OPTIONS);
      expect(Math.abs(peak.frequencyHz - freq)).toBeLessThan((0.1 * rate) / size);
      expect(peak.levelDb).toBeGreaterThan(20 * Math.log10(0.5) - 0.5);
    },
  );

  it.each([0, 0.1, 0.25, 0.4, 0.5])(
    "keeps interpolated Hann level within the documented 0.35 dB at %f bins off centre",
    async (fraction) => {
      const rate = 48000;
      const size = 2048;
      const x = sine(((64 + fraction) * rate) / size, 0.25, rate, rate);
      const s = await computeAverageSpectrum(x, rate, whole(x), size, "hann");
      const [peak] = detectPeaks(s.levelDb, rate, size, DEFAULT_PEAK_OPTIONS);
      expect(Math.abs(peak.levelDb - 20 * Math.log10(0.25))).toBeLessThan(0.35);
    },
  );

  it("analyses a selection shorter than the FFT by zero-padding", async () => {
    const x = sine(1000, 0.5, 48000, 48000);
    const s = await computeAverageSpectrum(x, 48000, { start: 100, end: 1100 }, 4096, "hann");
    expect(s.zeroPadded).toBe(true);
    const [peak] = detectPeaks(s.levelDb, 48000, 4096, DEFAULT_PEAK_OPTIONS);
    expect(Math.abs(peak.frequencyHz - 1000)).toBeLessThan(15);
    expect(peak.levelDb).toBeCloseTo(20 * Math.log10(0.5), 0);
  });
});

describe("test signal 2: two tones", () => {
  it("identifies both components and their levels", async () => {
    const rate = 44100;
    const x = addSignals(sine(440, 0.5, rate, rate * 2), sine(3000, 0.125, rate, rate * 2));
    const s = await computeAverageSpectrum(x, rate, whole(x), 8192, "hann");
    const peaks = detectPeaks(s.levelDb, rate, 8192, DEFAULT_PEAK_OPTIONS);
    expect(peaks).toHaveLength(2);
    expect(peaks[0].frequencyHz).toBeCloseTo(440, 0);
    expect(peaks[1].frequencyHz).toBeCloseTo(3000, 0);
    expect(peaks[0].levelDb - peaks[1].levelDb).toBeCloseTo(12.04, 0);
  });

  it("restricts detection to a frequency range", async () => {
    const rate = 44100;
    const x = addSignals(sine(440, 0.5, rate, rate), sine(3000, 0.125, rate, rate));
    const s = await computeAverageSpectrum(x, rate, whole(x), 4096, "hann");
    const peaks = detectPeaks(s.levelDb, rate, 4096, {
      ...DEFAULT_PEAK_OPTIONS,
      minHz: 1000,
      maxHz: 5000,
    });
    expect(peaks).toHaveLength(1);
    expect(peaks[0].frequencyHz).toBeCloseTo(3000, 0);
  });

  it("honours the minimum peak distance", async () => {
    const rate = 44100;
    const x = addSignals(sine(1000, 0.5, rate, rate * 2), sine(1100, 0.4, rate, rate * 2));
    const s = await computeAverageSpectrum(x, rate, whole(x), 16384, "hann");
    const close = detectPeaks(s.levelDb, rate, 16384, DEFAULT_PEAK_OPTIONS);
    const apart = detectPeaks(s.levelDb, rate, 16384, {
      ...DEFAULT_PEAK_OPTIONS,
      minDistanceHz: 500,
    });
    expect(close).toHaveLength(2);
    expect(apart).toHaveLength(1);
    expect(apart[0].frequencyHz).toBeCloseTo(1000, 0);
  });
});

describe("test signal 3: white noise", () => {
  const x = whiteNoise(0.5, 48000 * 10);

  it("has the statistics of uniform noise", () => {
    const m = measureAmplitude(x);
    expect(m.rms).toBeCloseTo(0.5 / Math.sqrt(3), 2);
    expect(Math.abs(m.mean)).toBeLessThan(0.005);
  });

  it("has a flat averaged spectrum and no false peaks", async () => {
    const s = await computeAverageSpectrum(x, 48000, whole(x), 1024, "hann");
    const lowHalf = s.levelDb.slice(8, 256).reduce((a, b) => a + b, 0) / 248;
    const highHalf = s.levelDb.slice(256, 504).reduce((a, b) => a + b, 0) / 248;
    expect(Math.abs(lowHalf - highHalf)).toBeLessThan(0.5);
    expect(detectPeaks(s.levelDb, 48000, 1024, DEFAULT_PEAK_OPTIONS)).toHaveLength(0);
  });
});

describe("test signal 4: silence", () => {
  const x = new Float32Array(48000);

  it("produces finite, zero measurements and null dB levels", () => {
    const m = measureAmplitude(x);
    expect(m.rms).toBe(0);
    expect(m.peak).toBe(0);
    expect(m.rmsDbfs).toBeNull();
    expect(m.peakDbfs).toBeNull();
    expect(m.crestFactor).toBeNull();
  });

  it("produces no peaks and no non-finite spectrum values", async () => {
    const s = await computeAverageSpectrum(x, 48000, whole(x), 2048, "hann");
    expect(s.levelDb.every((v) => v === DB_FLOOR)).toBe(true);
    expect(detectPeaks(s.levelDb, 48000, 2048, DEFAULT_PEAK_OPTIONS)).toHaveLength(0);
    const g = await computeSpectrogram(x, 48000, 1024, 512, "hann");
    expect(g.data.every(Number.isFinite)).toBe(true);
  });

  it("handles an empty range", async () => {
    const m = measureAmplitude(x, { start: 10, end: 10 });
    expect(m.sampleCount).toBe(0);
    expect(m.rmsDbfs).toBeNull();
    const s = await computeAverageSpectrum(x, 48000, { start: 10, end: 10 }, 1024, "hann");
    expect(s.framesAveraged).toBe(0);
  });
});

describe("test signal 5: clipping", () => {
  it("counts samples held at full scale", () => {
    const x = sine(1000, 2, 48000, 48000).map((v) => Math.max(-1, Math.min(1, v)));
    const m = measureAmplitude(x);
    const expected = x.filter((v) => Math.abs(v) === 1).length;
    expect(m.clippedSamples).toBe(expected);
    expect(expected).toBeGreaterThan(30000);
  });

  it("does not flag a signal just under full scale", () => {
    expect(measureAmplitude(sine(1000, 0.99, 48000, 48000)).clippedSamples).toBe(0);
  });
});

describe("test signal 7: DC offset", () => {
  it("reports the offset as the mean", () => {
    const x = sine(1000, 0.25, 48000, 48000).map((v) => v + 0.1);
    expect(measureAmplitude(x).mean).toBeCloseTo(0.1, 4);
    expect(measureAmplitude(x).maxPositive).toBeCloseTo(0.35, 3);
    expect(measureAmplitude(x).maxNegative).toBeCloseTo(-0.15, 3);
  });

  it("appears in bin zero of the spectrum at its true level", async () => {
    const x = new Float32Array(48000).fill(0.1);
    const s = await computeAverageSpectrum(x, 48000, whole(x), 2048, "hann");
    expect(s.levelDb[0]).toBeCloseTo(-20, 3);
  });
});

describe("peak detection", () => {
  it("ignores small ripples and flat plateaus", () => {
    const level = new Float32Array(100).fill(-60);
    level[20] = -58;
    level[50] = -20;
    level[70] = -30;
    level[71] = -30;
    level[72] = -30;
    const peaks = detectPeaks(level, 1000, 198, { ...DEFAULT_PEAK_OPTIONS, minDistanceHz: 0 });
    expect(peaks.map((p) => Math.round(p.levelDb))).toEqual([-20, -30]);
  });

  it("names frequency bands", () => {
    expect(frequencyBand(40)).toBe("Sub-bass");
    expect(frequencyBand(1000)).toBe("Mids");
    expect(frequencyBand(12000)).toBe("Brilliance");
  });
});

describe("spectrogram", () => {
  it("tracks a linear sweep over time", async () => {
    const rate = 48000;
    const x = sweep(1000, 9000, 0.5, rate, rate * 2);
    const g = await computeSpectrogram(x, rate, 2048, 512, "hann");
    for (const [t, expected] of [
      [0.5, 3000],
      [1, 5000],
      [1.5, 7000],
    ]) {
      const col = spectrogramColumnAt(g, t);
      let best = 0;
      for (let k = 1; k < g.bins; k++) {
        if (g.data[col * g.bins + k] > g.data[col * g.bins + best]) best = k;
      }
      expect(Math.abs(best * g.frequencyResolution - expected)).toBeLessThan(100);
    }
  });

  it("uses the same calibration as the spectrum", async () => {
    const rate = 48000;
    const size = 2048;
    const x = sine((64 * rate) / size, 0.5, rate, rate);
    const g = await computeSpectrogram(x, rate, size, 512, "blackman");
    const col = spectrogramColumnAt(g, 0.5);
    expect(g.data[col * g.bins + 64]).toBeCloseTo(20 * Math.log10(0.5), 3);
    expect(g.maxDb).toBeCloseTo(20 * Math.log10(0.5), 2);
  });

  it("averages frames into columns when memory-capped, preserving level", async () => {
    const rate = 48000;
    const size = 1024;
    const x = sine((32 * rate) / size, 0.5, rate, rate * 2);
    const g = await computeSpectrogram(x, rate, size, 256, "hann", undefined, 40_000);
    expect(g.framesPerColumn).toBeGreaterThan(1);
    expect(g.columns * g.bins).toBeLessThanOrEqual(40_000);
    expect(g.timeResolution).toBeCloseTo((256 * g.framesPerColumn) / rate, 9);
    const col = spectrogramColumnAt(g, 1);
    expect(g.data[col * g.bins + 32]).toBeCloseTo(20 * Math.log10(0.5), 2);
  });
});

describe("waveform pyramid", () => {
  it("preserves extremes at every level", async () => {
    const x = whiteNoise(0.8, 300_000);
    x[123_456] = 0.99;
    x[222_222] = -0.97;
    const pyramid = await buildWaveformPyramid(x);
    expect(pyramid.length).toBeGreaterThan(1);
    for (const level of pyramid) {
      expect(Math.max(...level.max)).toBeCloseTo(0.99, 5);
      expect(Math.min(...level.min)).toBeCloseTo(-0.97, 5);
    }
  });

  it("matches brute-force min/max for a block", async () => {
    const x = sine(100, 0.5, 8000, 8000);
    const [base] = await buildWaveformPyramid(x);
    const slice = x.subarray(2560, 2816);
    expect(base.max[10]).toBe(Math.max(...slice));
    expect(base.min[10]).toBe(Math.min(...slice));
  });

  it("selects raw samples when zoomed in past the base block", async () => {
    const pyramid = await buildWaveformPyramid(new Float32Array(1_000_000));
    expect(selectLevel(pyramid, 10)).toBeNull();
    expect(selectLevel(pyramid, 300)!.blockSize).toBe(256);
    expect(selectLevel(pyramid, 5000)!.blockSize).toBe(1024);
  });
});

describe("level conversion", () => {
  it("never yields infinity", () => {
    expect(amplitudeToDb(0)).toBeNull();
    expect(amplitudeToDb(1)).toBe(0);
  });

  it("adds short frames without NaN for a one-sample range", () => {
    const out = new Float64Array(513);
    new FrameAnalyzer(1024, "hann").addShortFrame(new Float32Array([0.5]), 0, 1, out);
    expect(out.every(Number.isFinite)).toBe(true);
  });
});
