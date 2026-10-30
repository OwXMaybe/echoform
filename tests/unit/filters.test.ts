import { describe, expect, it } from "vitest";
import { addSignals, sine, whiteNoise } from "@/core/audio/test-signals";
import { measureAmplitude } from "@/core/dsp/amplitude";
import {
  applySections,
  butterworthQs,
  chainSections,
  designBiquad,
  FILTER_ORDERS,
  FILTER_TYPES,
  filterSections,
  responseAt,
  type Biquad,
  type FilterConfiguration,
} from "@/core/dsp/filters";
import { computeAverageSpectrum } from "@/core/dsp/spectrum";

const RATE = 48000;

const filter = (patch: Partial<FilterConfiguration>): FilterConfiguration => ({
  id: "f",
  filterType: "lowpass",
  frequency: 1000,
  q: Math.SQRT1_2,
  gainDb: 0,
  order: 2,
  enabled: true,
  ...patch,
});

const gainAt = (sections: Biquad[], hz: number) => responseAt(sections, hz, RATE).magnitudeDb;

/** Measured gain of a steady tone through a cascade, ignoring the start-up transient. */
async function measuredGainDb(sections: Biquad[], hz: number): Promise<number> {
  const input = sine(hz, 0.1, RATE, RATE);
  const output = await applySections(input, sections);
  const tail = { start: RATE / 2, end: RATE };
  return (
    measureAmplitude(output, tail).rmsDbfs! - measureAmplitude(input, tail).rmsDbfs!
  );
}

describe("designed responses", () => {
  it("low-pass: passes DC, −3 dB at cutoff, rejects the top", () => {
    const s = filterSections(filter({ filterType: "lowpass" }), RATE);
    expect(gainAt(s, 1)).toBeCloseTo(0, 3);
    expect(gainAt(s, 1000)).toBeCloseTo(-3.01, 2);
    expect(gainAt(s, 10000)).toBeLessThan(-38);
  });

  it("high-pass: rejects low frequencies, −3 dB at cutoff, passes the top", () => {
    const s = filterSections(filter({ filterType: "highpass" }), RATE);
    expect(gainAt(s, 100)).toBeLessThan(-38);
    expect(gainAt(s, 1000)).toBeCloseTo(-3.01, 2);
    expect(gainAt(s, 20000)).toBeCloseTo(0, 1);
  });

  it("band-pass: 0 dB at the centre, whatever the Q", () => {
    for (const q of [0.5, 2, 20]) {
      const s = filterSections(filter({ filterType: "bandpass", q }), RATE);
      expect(gainAt(s, 1000)).toBeCloseTo(0, 6);
      expect(gainAt(s, 100)).toBeLessThan(-14);
    }
  });

  it("band-pass: Q sets the −3 dB bandwidth", () => {
    const s = filterSections(filter({ filterType: "bandpass", q: 10 }), RATE);
    // Edges of a 100 Hz band, geometric around the centre.
    const half = 50 * (1 + 1e-4);
    const lo = Math.sqrt(1000 * 1000 + half * half) - half;
    expect(gainAt(s, lo)).toBeCloseTo(-3.01, 0);
    expect(gainAt(s, lo + 2 * half)).toBeCloseTo(-3.01, 0);
  });

  it("notch: removes the centre and leaves the rest", () => {
    const s = filterSections(filter({ filterType: "notch", q: 10 }), RATE);
    expect(gainAt(s, 1000)).toBeLessThan(-100);
    expect(gainAt(s, 100)).toBeCloseTo(0, 1);
    expect(gainAt(s, 10000)).toBeCloseTo(0, 1);
  });

  it.each([12, 6, -6, -12])("peaking: exactly %i dB at the centre", (gainDb) => {
    const s = filterSections(filter({ filterType: "peaking", q: 2, gainDb }), RATE);
    expect(gainAt(s, 1000)).toBeCloseTo(gainDb, 6);
    expect(gainAt(s, 20)).toBeCloseTo(0, 1);
    expect(gainAt(s, 20000)).toBeCloseTo(0, 1);
  });

  it.each([6, -6])("low shelf: %i dB below, half at the midpoint, 0 above", (gainDb) => {
    const s = filterSections(filter({ filterType: "lowshelf", gainDb }), RATE);
    expect(gainAt(s, 10)).toBeCloseTo(gainDb, 2);
    expect(gainAt(s, 1000)).toBeCloseTo(gainDb / 2, 6);
    expect(gainAt(s, 20000)).toBeCloseTo(0, 2);
  });

  it.each([6, -6])("high shelf: 0 below, half at the midpoint, %i dB above", (gainDb) => {
    const s = filterSections(filter({ filterType: "highshelf", gainDb }), RATE);
    expect(gainAt(s, 10)).toBeCloseTo(0, 2);
    expect(gainAt(s, 1000)).toBeCloseTo(gainDb / 2, 6);
    expect(gainAt(s, 23900)).toBeCloseTo(gainDb, 1);
  });

  it("a Q above Butterworth resonates at the cutoff", () => {
    const s = filterSections(filter({ filterType: "lowpass", q: 5 }), RATE);
    expect(gainAt(s, 1000)).toBeCloseTo(13.98, 1);
  });
});

describe("filter order", () => {
  it("uses the textbook Butterworth section Qs", () => {
    expect(butterworthQs(2)[0]).toBeCloseTo(0.7071, 4);
    const fourth = butterworthQs(4);
    expect(fourth[0]).toBeCloseTo(0.5412, 4);
    expect(fourth[1]).toBeCloseTo(1.3066, 4);
  });

  it.each(FILTER_ORDERS)("order %i stays −3 dB at cutoff", (order) => {
    for (const filterType of ["lowpass", "highpass"] as const) {
      const s = filterSections(filter({ filterType, order }), RATE);
      expect(s.length).toBe(order / 2);
      expect(gainAt(s, 1000)).toBeCloseTo(-3.01, 1);
    }
  });

  it("each extra order adds about 6 dB per octave", () => {
    const slope = (order: 2 | 4 | 6 | 8) => {
      const s = filterSections(filter({ order, frequency: 500 }), RATE);
      return gainAt(s, 2000) - gainAt(s, 4000);
    };
    // The bilinear transform steepens the slope slightly as frequency rises.
    expect(Math.abs(slope(2) - 12)).toBeLessThan(1);
    expect(Math.abs(slope(4) - 24)).toBeLessThan(1);
    expect(slope(8)).toBeGreaterThan(46);
  });
});

describe("filter stability", () => {
  const stable = ({ a1, a2 }: Biquad) => Math.abs(a2) < 1 && Math.abs(a1) < 1 + a2;

  it("keeps every design's poles inside the unit circle", () => {
    for (const type of FILTER_TYPES) {
      for (const hz of [1, 20, 1000, 20000, 23500, 96000]) {
        for (const q of [0.1, 0.707, 30]) {
          for (const gain of [-24, 0, 24]) {
            expect(stable(designBiquad(type, hz, q, gain, RATE))).toBe(true);
          }
        }
      }
    }
  });

  it("decays after an impulse", async () => {
    const impulse = new Float32Array(RATE);
    impulse[0] = 1;
    const s = filterSections(filter({ filterType: "peaking", q: 30, gainDb: 24 }), RATE);
    const out = await applySections(impulse, s);
    expect(measureAmplitude(out, { start: RATE - 1000, end: RATE }).peak).toBeLessThan(1e-6);
  });
});

describe("running a filter", () => {
  it.each([100, 1000, 5000])("measured gain matches the design at %i Hz", async (hz) => {
    const s = filterSections(filter({ filterType: "lowpass", order: 4, frequency: 1000 }), RATE);
    expect(await measuredGainDb(s, hz)).toBeCloseTo(gainAt(s, hz), 1);
  });

  it("removes a known component and keeps the other", async () => {
    const input = addSignals(sine(200, 0.4, RATE, RATE), sine(8000, 0.4, RATE, RATE));
    const s = filterSections(filter({ filterType: "lowpass", order: 8 }), RATE);
    const output = await applySections(input, s);
    const { levelDb, frequencyResolution: df } = await computeAverageSpectrum(
      output,
      RATE,
      { start: 4096, end: RATE },
      4096,
      "hann",
    );
    expect(levelDb[Math.round(200 / df)]).toBeGreaterThan(-9);
    expect(levelDb[Math.round(8000 / df)]).toBeLessThan(-120);
  });

  it("leaves the input untouched", async () => {
    const input = whiteNoise(0.5, 2000);
    const copy = input.slice();
    await applySections(input, filterSections(filter({}), RATE));
    expect(input).toEqual(copy);
  });

  it("with no sections, returns an exact copy", async () => {
    const input = whiteNoise(0.5, 2000);
    const output = await applySections(input, []);
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
  });

  it("can exceed full scale, and reports it rather than clamping", async () => {
    const input = sine(1000, 0.9, RATE, RATE);
    const s = filterSections(filter({ filterType: "peaking", gainDb: 12 }), RATE);
    expect(measureAmplitude(await applySections(input, s)).peak).toBeGreaterThan(3);
  });
});

describe("filter chains", () => {
  it("skips disabled filters", () => {
    const chain = [filter({ enabled: false }), filter({ filterType: "highpass" })];
    expect(chainSections(chain, RATE).length).toBe(1);
  });

  it("adds the gains of its sections", () => {
    const one = filter({ filterType: "peaking", gainDb: 3 });
    expect(gainAt(chainSections([one, one], RATE), 1000)).toBeCloseTo(6, 6);
  });

  it("reports the −90° phase of a second-order low-pass at cutoff", () => {
    const { phaseRadians } = responseAt(filterSections(filter({}), RATE), 1000, RATE);
    expect(phaseRadians).toBeCloseTo(-Math.PI / 2, 2);
  });

  it("clamps a frequency above Nyquist instead of producing an unstable filter", () => {
    const s = filterSections(filter({ frequency: 96000 }), RATE);
    expect(Number.isFinite(gainAt(s, 1000))).toBe(true);
    expect(gainAt(s, 1000)).toBeCloseTo(0, 2);
  });
});
