import { describe, expect, it } from "vitest";
import { addSignals, sine, whiteNoise } from "@/core/audio/test-signals";
import { computeNovelty, pickOnsets } from "@/core/dsp/onset";
import { estimateTempo } from "@/core/dsp/tempo";

const RATE = 48000;
const DEFAULT_SENSITIVITY = 0.5;

/** Decaying noise bursts at known times, like percussion. */
function bursts(times: number[], seconds: number, level = 0.5): Float32Array {
  const out = new Float32Array(RATE * seconds);
  const noise = whiteNoise(1, RATE, 99);
  for (const time of times) {
    const start = Math.round(time * RATE);
    for (let i = 0; i < RATE * 0.08 && start + i < out.length; i++) {
      out[start + i] += level * noise[i] * Math.exp(-i / (RATE * 0.015));
    }
  }
  return out;
}

const pulse = (bpm: number, seconds: number) =>
  Array.from({ length: Math.floor((seconds * bpm) / 60) }, (_, i) => 0.1 + (i * 60) / bpm);

async function onsetsOf(x: Float32Array, sensitivity = DEFAULT_SENSITIVITY, rate = RATE) {
  return pickOnsets(await computeNovelty(x, rate), sensitivity).events;
}

describe("onset detection", () => {
  it("finds every burst, close to its true time", async () => {
    const times = [0.5, 1.1, 1.3, 2.2, 3.7];
    const events = await onsetsOf(bursts(times, 4));
    expect(events.length).toBe(times.length);
    events.forEach((event, i) => expect(Math.abs(event.time - times[i])).toBeLessThan(0.012));
  });

  it("finds the entry of a steady tone once", async () => {
    const x = new Float32Array(RATE * 3);
    x.set(sine(1000, 0.5, RATE, RATE), RATE);
    const events = await onsetsOf(x);
    expect(events.length).toBe(1);
    expect(Math.abs(events[0].time - 1)).toBeLessThan(0.012);
  });

  it("finds a change of note with no change of level", async () => {
    const x = new Float32Array(RATE * 2);
    x.set(sine(440, 0.5, RATE, RATE), 0);
    x.set(sine(660, 0.5, RATE, RATE), RATE);
    const events = await onsetsOf(x);
    expect(events.filter((e) => Math.abs(e.time - 1) < 0.03).length).toBe(1);
  });

  it("finds nothing in silence or a steady tone", async () => {
    expect(await onsetsOf(new Float32Array(RATE))).toEqual([]);
    const events = await onsetsOf(sine(1000, 0.5, RATE, RATE * 2));
    expect(events.length).toBe(0);
  });

  it("does not treat steady noise as a stream of events", async () => {
    expect((await onsetsOf(whiteNoise(0.3, RATE * 4))).length).toBeLessThan(3);
  });

  it("merges events closer than the minimum gap", async () => {
    expect((await onsetsOf(bursts([1, 1.02], 2))).length).toBe(1);
  });

  it("finds a soft burst well after a loud one at higher sensitivity", async () => {
    const x = addSignals(bursts([0.5], 3), bursts([2], 3, 0.02));
    expect((await onsetsOf(x, 0.9)).length).toBe(2);
  });

  it("finds no more events as sensitivity falls", async () => {
    const x = addSignals(bursts([0.5, 1, 1.5, 2], 3), bursts([0.75, 1.25], 3, 0.005));
    const novelty = await computeNovelty(x, RATE);
    const counts = [0.9, 0.5, 0.1].map((s) => pickOnsets(novelty, s).events.length);
    expect(counts[0]).toBeGreaterThanOrEqual(counts[1]);
    expect(counts[1]).toBeGreaterThanOrEqual(counts[2]);
  });

  it("works at other sample rates", async () => {
    const rate = 22050;
    const x = new Float32Array(rate * 2);
    x.set(sine(800, 0.5, rate, rate / 2), rate);
    const events = await onsetsOf(x, DEFAULT_SENSITIVITY, rate);
    expect(events.length).toBe(1);
    expect(Math.abs(events[0].time - 1)).toBeLessThan(0.02);
  });

  it("returns an empty curve for audio shorter than one frame", async () => {
    expect((await computeNovelty(new Float32Array(10), RATE)).novelty.length).toBe(0);
  });
});

describe("tempo estimation", () => {
  const tempoOf = async (x: Float32Array) => {
    const { novelty, hopSeconds } = await computeNovelty(x, RATE);
    return estimateTempo(novelty, hopSeconds);
  };

  it.each([70, 90, 120, 128, 150])("finds %i BPM from a click track", async (bpm) => {
    const result = await tempoOf(bursts(pulse(bpm, 20), 20));
    expect(Math.abs(result.bpm! - bpm)).toBeLessThan(1);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("lists related tempi as alternatives", async () => {
    const { candidates } = await tempoOf(bursts(pulse(120, 20), 20));
    expect(candidates[0].relation).toBe("best");
    expect(candidates.some((c) => c.relation === "half" || c.relation === "double")).toBe(true);
  });

  it("keeps a pulse with accents", async () => {
    const beat = 0.5;
    const times = pulse(120, 20);
    const accents = times.filter((_, i) => i % 4 === 0);
    const x = addSignals(bursts(times, 20, 0.2), bursts(accents, 20, 0.5));
    expect(Math.abs(60 / (await tempoOf(x)).bpm! - beat)).toBeLessThan(0.01);
  });

  it("reports no tempo for steady noise", async () => {
    const result = await tempoOf(whiteNoise(0.3, RATE * 10));
    expect(result.bpm).toBeNull();
    expect(result.reason).not.toBeNull();
  });

  it("reports no tempo for a steady tone", async () => {
    expect((await tempoOf(sine(440, 0.5, RATE, RATE * 10))).bpm).toBeNull();
  });

  it("reports no tempo for irregular events", async () => {
    // Seeded, unevenly spaced times.
    const noise = whiteNoise(1, 30, 31337);
    let time = 0.2;
    const times = Array.from(noise, (v) => (time += 0.2 + 0.45 * (v + 1)));
    const result = await tempoOf(bursts(times.filter((t) => t < 19.9), 20));
    expect(result.bpm).toBeNull();
  });

  it("refuses to estimate from a very short range", async () => {
    const result = await tempoOf(bursts(pulse(120, 2), 2));
    expect(result.bpm).toBeNull();
    expect(result.reason).toContain("seconds");
  });
});
