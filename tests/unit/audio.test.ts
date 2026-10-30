import { describe, expect, it } from "vitest";
import { identifyAudioFile } from "@/core/audio/file-format";
import { createDemoSignal } from "@/core/audio/test-signals";
import { encodeWav16 } from "@/core/audio/wav";
import { measureAmplitude } from "@/core/dsp/amplitude";
import { computeAverageSpectrum } from "@/core/dsp/spectrum";
import { DEFAULT_PEAK_OPTIONS, detectPeaks } from "@/core/dsp/peaks";
import {
  defaultFrequencyAxis,
  fractionToFrequency,
  frequencyTicks,
  frequencyToFraction,
  linearTicks,
} from "@/core/visualization/scales";
import { colorMapLut } from "@/core/visualization/color-maps";

const bytes = (...values: number[]) => Uint8Array.from(values).buffer;
const text = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe("file identification", () => {
  it("reads WAV properties from the header", () => {
    const wav = encodeWav16([new Float32Array(10), new Float32Array(10)], 44100);
    expect(identifyAudioFile(wav)).toMatchObject({
      format: "wav",
      sampleRate: 44100,
      channelCount: 2,
      bitDepth: 16,
      encoding: "PCM integer",
    });
  });

  it("reads FLAC STREAMINFO", () => {
    // 96 kHz, 2 channels, 24 bits: 0x17700 << 12 | 1 << 9 | 23 << 4.
    const packed = (96000 * 4096 + (1 << 9) + (23 << 4)) >>> 0;
    const file = new Uint8Array(42);
    file.set(text("fLaC"));
    new DataView(file.buffer).setUint32(18, packed, false);
    expect(identifyAudioFile(file.buffer)).toMatchObject({
      format: "flac",
      sampleRate: 96000,
      channelCount: 2,
      bitDepth: 24,
    });
  });

  it("reads an MP3 frame header, skipping ID3", () => {
    const frame = [0xff, 0xfb, 0x90, 0x00];
    expect(identifyAudioFile(bytes(...frame))).toMatchObject({
      format: "mp3",
      sampleRate: 44100,
      bitDepth: null,
      channelCount: 2,
    });
    const id3 = [...text("ID3"), 4, 0, 0, 0, 0, 0, 2, 0, 0, ...frame];
    expect(identifyAudioFile(bytes(...id3)).format).toBe("mp3");
  });

  it("reads an Ogg Vorbis identification header", () => {
    const file = new Uint8Array(60);
    file.set(text("OggS"));
    file[26] = 1;
    file[28] = 1;
    file.set(text("vorbis"), 29);
    file[39] = 2;
    new DataView(file.buffer).setUint32(40, 32000, true);
    expect(identifyAudioFile(file.buffer)).toMatchObject({
      format: "ogg",
      encoding: "Vorbis",
      sampleRate: 32000,
      channelCount: 2,
    });
  });

  it("recognises MP4 without inventing a sample rate", () => {
    const file = [0, 0, 0, 32, ...text("ftypM4A ")];
    expect(identifyAudioFile(bytes(...file))).toMatchObject({ format: "m4a", sampleRate: null });
  });

  it("does not trust arbitrary bytes", () => {
    expect(identifyAudioFile(bytes(...text("<html>not audio")))).toMatchObject({
      format: "unknown",
    });
    expect(identifyAudioFile(new ArrayBuffer(0)).format).toBe("unknown");
  });
});

describe("WAV encoding", () => {
  it("stores samples in little-endian interleaved order", () => {
    const wav = encodeWav16([new Float32Array([1, -1]), new Float32Array([0, 0.5])], 8000);
    const view = new DataView(wav);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(-32768);
    expect(view.getInt16(50, true)).toBe(Math.round(0.5 * 32767));
  });
});

describe("demo signal", () => {
  const demo = createDemoSignal();
  const rate = demo.sampleRate;

  it("contains the documented harmonic tone", async () => {
    const left = demo.channels[0];
    const s = await computeAverageSpectrum(left, rate, { start: 0, end: rate * 3 }, 8192, "hann");
    const found = detectPeaks(s.levelDb, rate, 8192, DEFAULT_PEAK_OPTIONS)
      .map((p) => Math.round(p.frequencyHz))
      .sort((a, b) => a - b);
    expect(found).toEqual([220, 440, 660]);
  });

  it("ends in digital silence", () => {
    const m = measureAmplitude(demo.channels[0], { start: rate * 5, end: rate * 6 });
    expect(m.peak).toBe(0);
  });

  it("differs between channels during the sweep", () => {
    const range = { start: rate * 3, end: rate * 5 };
    expect(measureAmplitude(demo.channels[1], range).peak).toBeCloseTo(0.25, 2);
    expect(measureAmplitude(demo.channels[0], range).peak).toBeCloseTo(0.5, 2);
  });
});

describe("scales", () => {
  it("round-trips frequency on both scales", () => {
    for (const scale of ["log", "linear"] as const) {
      const axis = defaultFrequencyAxis(48000, scale);
      for (const hz of [50, 1000, 15000]) {
        expect(fractionToFrequency(frequencyToFraction(hz, axis), axis)).toBeCloseTo(hz, 6);
      }
    }
  });

  it("produces ticks inside the axis", () => {
    const axis = defaultFrequencyAxis(44100, "log");
    expect(frequencyTicks(axis)).toContain(1000);
    expect(frequencyTicks(axis).every((t) => t >= 20 && t <= 22050)).toBe(true);
    expect(linearTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
  });
});

describe("color maps", () => {
  it("builds opaque, distinct 256-entry tables", () => {
    const lut = colorMapLut("magma");
    expect(lut).toHaveLength(256);
    expect(lut[0] >>> 24).toBe(255);
    expect(lut[0]).not.toBe(lut[255]);
  });
});

