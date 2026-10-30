import { describe, expect, it } from "vitest";
import { addSignals, sine, sweep, whiteNoise } from "@/core/audio/test-signals";
import { analyseHarmonics } from "@/core/dsp/harmonics";
import { detectHum, estimateNoise } from "@/core/dsp/noise";
import { frequencyToNote, summarisePitch, trackPitch } from "@/core/dsp/pitch";
import { computeAverageSpectrum } from "@/core/dsp/spectrum";

const RATE = 48000;
const whole = (x: Float32Array) => ({ start: 0, end: x.length });

async function pitchOf(x: Float32Array, rate = RATE) {
  const track = await trackPitch(x, rate);
  return summarisePitch(track, 0, x.length / rate);
}

const harmonicTone = (f0: number, seconds: number, numbers = [1, 2, 3, 4, 5]) =>
  addSignals(...numbers.map((n) => sine(f0 * n, 0.3 / n, RATE, RATE * seconds)));

describe("pitch estimation", () => {
  it.each([65, 110, 220, 440, 1000, 1760])("tracks a %i Hz sine", async (hz) => {
    const { medianHz, voicedRatio } = await pitchOf(sine(hz, 0.5, RATE, RATE));
    // Near the top of the range one period is only about 9 samples at 16 kHz.
    expect(Math.abs(1200 * Math.log2(medianHz! / hz))).toBeLessThan(hz > 1000 ? 12 : 5);
    expect(voicedRatio).toBeGreaterThan(0.95);
  });

  it("finds the fundamental of a harmonic tone", async () => {
    expect(Math.abs((await pitchOf(harmonicTone(196, 1))).medianHz! - 196)).toBeLessThan(1);
  });

  it("finds a missing fundamental", async () => {
    const x = harmonicTone(200, 1, [2, 3, 4]);
    expect(Math.abs((await pitchOf(x)).medianHz! - 200)).toBeLessThan(2);
  });

  it("follows a glide", async () => {
    const x = sweep(200, 800, 0.5, RATE, RATE * 2);
    const track = await trackPitch(x, RATE);
    const at = (t: number) => summarisePitch(track, t - 0.02, t + 0.02).medianHz!;
    expect(Math.abs(at(0.5) - 350)).toBeLessThan(8);
    expect(Math.abs(at(1.5) - 650)).toBeLessThan(8);
  });

  it("works without decimation at a low sample rate", async () => {
    const rate = 8000;
    expect(Math.abs((await pitchOf(sine(300, 0.5, rate, rate), rate)).medianHz! - 300)).toBeLessThan(3);
  });

  it("stays silent on white noise rather than guessing", async () => {
    expect((await pitchOf(whiteNoise(0.3, RATE))).voicedRatio).toBeLessThan(0.05);
  });

  it("reports no pitch for a tone below its range", async () => {
    const { voicedRatio } = await pitchOf(sine(45, 0.5, RATE, RATE));
    expect(voicedRatio).toBeLessThan(0.02);
  });

  it("reports nothing for digital silence", async () => {
    const summary = await pitchOf(new Float32Array(RATE));
    expect(summary.medianHz).toBeNull();
    expect(summary.voicedRatio).toBe(0);
  });

  it("ignores the silent part of a recording in its pitch", async () => {
    const x = new Float32Array(RATE * 2);
    x.set(sine(330, 0.5, RATE, RATE), RATE);
    const { medianHz, voicedRatio } = await pitchOf(x);
    expect(Math.abs(medianHz! - 330)).toBeLessThan(2);
    expect(voicedRatio).toBeGreaterThan(0.4);
    expect(voicedRatio).toBeLessThan(0.6);
  });

  it("places frames at the right time", async () => {
    const x = new Float32Array(RATE * 2);
    x.set(sine(330, 0.5, RATE, RATE), RATE);
    const track = await trackPitch(x, RATE);
    expect(summarisePitch(track, 1.1, 1.3).voicedRatio).toBeGreaterThan(0.95);
    expect(summarisePitch(track, 0.7, 0.9).voicedRatio).toBe(0);
  });

  it("reads harmonic-to-noise ratio from periodicity", async () => {
    const clean = await pitchOf(harmonicTone(220, 1));
    const noisy = await pitchOf(
      addSignals(harmonicTone(220, 1), whiteNoise(0.1, RATE)),
    );
    expect(clean.harmonicToNoiseDb === null || clean.harmonicToNoiseDb > 30).toBe(true);
    expect(noisy.harmonicToNoiseDb!).toBeLessThan(25);
    expect(noisy.harmonicToNoiseDb!).toBeGreaterThan(5);
  });
});

describe("note names", () => {
  it.each([
    [440, "A4"],
    [261.63, "C4"],
    [27.5, "A0"],
    [4186, "C8"],
  ])("%f Hz is %s", (hz, name) => {
    const note = frequencyToNote(hz);
    expect(note.name).toBe(name);
    expect(Math.abs(note.cents)).toBeLessThan(2);
  });

  it("reports the distance from the nearest note", () => {
    expect(frequencyToNote(440 * Math.pow(2, 25 / 1200)).cents).toBeCloseTo(25, 3);
  });
});

describe("harmonic analysis", () => {
  const spectrumOf = async (x: Float32Array, fft = 8192) =>
    computeAverageSpectrum(x, RATE, whole(x), fft, "hann");

  it("measures the frequency and level of each harmonic", async () => {
    const { levelDb } = await spectrumOf(harmonicTone(220, 2));
    const { rows, resolvable } = analyseHarmonics(levelDb, RATE, 8192, 220);
    expect(resolvable).toBe(true);
    expect(Math.abs(rows[1].measuredHz! - 440)).toBeLessThan(1);
    expect(Math.abs(rows[1].relativeDb! + 6.02)).toBeLessThan(0.5);
    expect(Math.abs(rows[3].relativeDb! + 12.04)).toBeLessThan(0.5);
    expect(rows[5].measuredHz).toBeNull();
  });

  it("reports a missing harmonic as missing, not as a level", async () => {
    const { levelDb } = await spectrumOf(harmonicTone(220, 2, [1, 3]));
    const { rows } = analyseHarmonics(levelDb, RATE, 8192, 220);
    expect(rows[1].levelDb).toBeNull();
    expect(rows[2].levelDb).not.toBeNull();
  });

  it("measures inharmonic partials as deviations", async () => {
    const x = addSignals(sine(200, 0.3, RATE, RATE * 2), sine(412, 0.3, RATE, RATE * 2));
    const { levelDb } = await spectrumOf(x);
    const { rows } = analyseHarmonics(levelDb, RATE, 8192, 200);
    expect(Math.abs(rows[1].deviationCents! - 51.2)).toBeLessThan(5);
  });

  it("declines when the FFT cannot resolve the harmonics", async () => {
    const { levelDb } = await spectrumOf(harmonicTone(60, 1), 1024);
    const result = analyseHarmonics(levelDb, RATE, 1024, 60);
    expect(result.resolvable).toBe(false);
    expect(result.rows).toEqual([]);
  });

  it("stops at Nyquist", async () => {
    const { levelDb } = await spectrumOf(sine(9000, 0.5, RATE, RATE));
    const { rows } = analyseHarmonics(levelDb, RATE, 8192, 9000);
    expect(rows.length).toBe(2);
  });
});

describe("noise estimation", () => {
  /** Tone bursts over noise of a known level. */
  function burstsOverNoise(noiseAmplitude: number, seconds = 10): Float32Array {
    const noise = whiteNoise(noiseAmplitude, RATE * seconds);
    const tone = sine(1000, 0.5, RATE, RATE * seconds);
    for (let i = 0; i < noise.length; i++) {
      if (Math.floor(i / RATE) % 2 === 1) noise[i] += tone[i];
    }
    return noise;
  }
  // Uniform noise of amplitude A has RMS A / sqrt(3).
  const rmsDb = (amplitude: number) => 20 * Math.log10(amplitude / Math.sqrt(3));

  it("finds a known floor between bursts", async () => {
    const x = burstsOverNoise(0.002);
    const result = await estimateNoise(x, RATE, whole(x));
    expect(result.confidence).toBe("moderate");
    expect(Math.abs(result.noiseFloorDb! - rmsDb(0.002))).toBeLessThan(1);
  });

  it("gives the SNR between bursts and floor", async () => {
    const x = burstsOverNoise(0.002);
    const { snrDb } = await estimateNoise(x, RATE, whole(x));
    expect(Math.abs(snrDb! - (-9.03 - rmsDb(0.002)))).toBeLessThan(1.5);
  });

  it("names a time interval that is actually quiet", async () => {
    const x = burstsOverNoise(0.002);
    const { interval } = await estimateNoise(x, RATE, whole(x));
    expect(Math.floor(interval!.start) % 2).toBe(0);
    expect(interval!.end - interval!.start).toBeGreaterThan(0.1);
  });

  it("gives no noise figure for continuous audio with no quiet passages", async () => {
    const x = sine(1000, 0.5, RATE, RATE * 5);
    const result = await estimateNoise(x, RATE, whole(x));
    expect(result.confidence).toBe("none");
    expect(result.noiseFloorDb).toBeNull();
    expect(result.snrDb).toBeNull();
    expect(result.reason).not.toBeNull();
  });

  it("does not call steady noise the floor of anything", async () => {
    const x = whiteNoise(0.3, RATE * 5);
    expect((await estimateNoise(x, RATE, whole(x))).noiseFloorDb).toBeNull();
  });

  it("withholds SNR when quiet frames are rare", async () => {
    const x = sine(1000, 0.5, RATE, RATE * 20);
    // About 7% of frames: enough to set the floor, not enough to trust it.
    for (let i = 0; i < RATE * 1.4; i++) x[RATE + i] *= 0.001;
    const result = await estimateNoise(x, RATE, whole(x));
    expect(result.confidence).toBe("low");
    expect(result.snrDb).toBeNull();
  });

  it("does not read digital silence as a floor", async () => {
    const x = burstsOverNoise(0.002);
    x.fill(0, 0, RATE);
    const result = await estimateNoise(x, RATE, whole(x));
    expect(Math.abs(result.noiseFloorDb! - rmsDb(0.002))).toBeLessThan(1);
  });

  it("handles all-silent and very short audio", async () => {
    const silent = new Float32Array(RATE * 2);
    expect((await estimateNoise(silent, RATE, whole(silent))).confidence).toBe("none");
    const short = sine(100, 0.5, RATE, 100);
    expect((await estimateNoise(short, RATE, whole(short))).confidence).toBe("none");
  });

  it.each([50, 60])("flags a %i Hz hum", async (hz) => {
    const x = addSignals(whiteNoise(0.001, RATE * 5), sine(hz, 0.01, RATE, RATE * 5));
    const hum = await detectHum(x, RATE, whole(x));
    expect(hum.map((h) => h.frequencyHz)).toEqual([hz]);
    expect(Math.abs(hum[0].levelDb + 40)).toBeLessThan(1.5);
  });

  it("finds a hum in the quiet passages under much louder audio", async () => {
    const x = addSignals(whiteNoise(0.001, RATE * 10), sine(50, 0.002, RATE, RATE * 10));
    const loud = whiteNoise(0.4, RATE, 5);
    for (let i = 0; i < RATE; i++) for (const s of [1, 3, 5, 7]) x[s * RATE + i] += loud[i];
    const { hum } = await estimateNoise(x, RATE, whole(x));
    expect(hum.map((h) => h.frequencyHz)).toEqual([50]);
  });

  it("flags no hum in noise or away from mains frequencies", async () => {
    expect(await detectHum(whiteNoise(0.1, RATE * 5), RATE, { start: 0, end: RATE * 5 })).toEqual([]);
    const tone = addSignals(whiteNoise(0.001, RATE * 5), sine(100, 0.1, RATE, RATE * 5));
    expect(await detectHum(tone, RATE, whole(tone))).toEqual([]);
  });
});
