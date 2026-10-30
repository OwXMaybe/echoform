import { describe, expect, it } from "vitest";
import { sine } from "@/core/audio/test-signals";
import { measureAmplitude } from "@/core/dsp/amplitude";
import { computeDescriptors } from "@/core/dsp/descriptors";
import { computeAverageSpectrum } from "@/core/dsp/spectrum";
import { analyseStereo } from "@/core/dsp/stereo";
import {
  buildReport,
  reportFileName,
  reportToCsv,
  reportToJson,
  type ReportInput,
} from "@/core/reports/report";
import { reportToHtml } from "@/core/reports/report-html";
import { parseStoredSettings } from "@/core/settings/stored-settings";
import type { AudioRecording } from "@/types/audio";

const RATE = 48000;

async function input(patch: Partial<ReportInput> = {}): Promise<ReportInput> {
  const x = sine(1000, 0.5, RATE, RATE);
  const spectrum = await computeAverageSpectrum(x, RATE, { start: 0, end: RATE }, 2048, "hann");
  const recording: AudioRecording = {
    id: "id",
    original: {
      name: "take one.wav",
      sizeBytes: 1000,
      mimeType: "audio/wav",
      format: "wav",
      formatLabel: "WAV",
      encoding: "PCM integer",
      sampleRate: RATE,
      channelCount: 1,
      bitDepth: 16,
    },
    decoded: {
      sampleRate: RATE,
      channelCount: 1,
      frameCount: RATE,
      duration: 1,
      resampled: false,
      channelLabels: ["Mono"],
    },
    warnings: [],
  };
  return {
    recording,
    generatedAt: "2026-10-30T12:00:00.000Z",
    includeFileNames: true,
    scope: { start: 0, end: 1, selected: false },
    band: null,
    configuration: {
      fftSize: 2048,
      hopSize: 512,
      windowFunction: "hann",
      channel: "Mono",
      rolloffPercent: 85,
      peakProminenceDb: 12,
      silenceThresholdDb: -60,
      silenceMinSeconds: 0.5,
      silencePaddingSeconds: 0,
      dcWarningThreshold: 0.01,
    },
    amplitude: [{ label: "Mono", measurement: measureAmplitude(x) }],
    spectrum,
    peaks: [{ frequencyHz: 1000, levelDb: -6, prominenceDb: 80, band: "Mids" }],
    descriptors: computeDescriptors(spectrum.levelDb, RATE, 2048, {
      windowFunction: "hann",
      rolloffPercent: 85,
    }),
    stereo: null,
    silence: null,
    clipping: { intervals: [], totalIntervals: 0, clippedSamples: 0 },
    filters: { list: [], rendered: null },
    comparison: null,
    events: null,
    ...patch,
  };
}

describe("report model", () => {
  it("carries the computed measurements through unchanged", async () => {
    const data = await input();
    const report = buildReport(data);
    expect(report.timeDomain![0].rmsDbfs).toBe(data.amplitude![0].measurement.rmsDbfs);
    expect(report.spectral!.centroidHz).toBe(data.descriptors!.centroidHz);
    expect(report.frequencyDomain!.peaks).toEqual(data.peaks);
  });

  it("reports what was not computed as null, never as zero", async () => {
    const report = buildReport(await input({ amplitude: null, spectrum: null, descriptors: null }));
    expect(report.timeDomain).toBeNull();
    expect(report.frequencyDomain).toBeNull();
    expect(report.spectral).toBeNull();
    expect(report.channelAnalysis).toBeNull();
    expect(report.comparison).toBeNull();
  });

  it("includes the configuration needed to reproduce it", async () => {
    const report = buildReport(await input());
    expect(report.configuration.fftSize).toBe(2048);
    expect(report.configuration.windowFunction).toBe("hann");
    expect(report.schemaVersion).toBe(1);
  });

  it("states methodology and limitations", async () => {
    const report = buildReport(await input());
    expect(report.methodology.some((m) => m.title === "RMS level")).toBe(true);
    expect(report.limitations.some((l) => l.includes("not LUFS"))).toBe(true);
  });

  it("only documents methods it used", async () => {
    const titles = buildReport(await input()).methodology.map((m) => m.title);
    expect(titles).not.toContain("Channel correlation");
    expect(titles).not.toContain("Tempo estimate");
  });

  it("leaves out disabled filters", async () => {
    const filter = {
      id: "a",
      filterType: "lowpass" as const,
      frequency: 1000,
      q: 0.7,
      gainDb: 0,
      order: 2 as const,
      enabled: false,
    };
    const off = buildReport(await input({ filters: { list: [filter], rendered: null } }));
    expect(off.filters).toBeNull();
    const on = buildReport(
      await input({ filters: { list: [{ ...filter, enabled: true }], rendered: null } }),
    );
    expect(on.filters!.list.length).toBe(1);
    expect(on.filters!.list[0]).not.toHaveProperty("id");
  });

  it("keeps stereo summaries but not the sample-level arrays", async () => {
    const x = sine(1000, 0.5, RATE, RATE);
    const stereo = await analyseStereo(x, x, RATE);
    const report = buildReport(await input({ stereo }));
    expect(report.channelAnalysis!.correlation).toBeCloseTo(1, 5);
    expect(report.channelAnalysis).not.toHaveProperty("vectorscope");
    expect(() => reportToJson(report)).not.toThrow();
  });

  it("downsamples the spectrum curve", async () => {
    const { spectrumCurve } = buildReport(await input());
    expect(spectrumCurve!.levelDb.length).toBeLessThanOrEqual(240);
    // 1 kHz falls between bins here, so the Hann window reads it a little low.
    expect(Math.abs(Math.max(...spectrumCurve!.levelDb) + 6.02)).toBeLessThan(1.5);
  });
});

describe("file-name privacy", () => {
  it("withholds names from every format when asked", async () => {
    const data = await input({ includeFileNames: false });
    data.recording.warnings = ['Problem with "take one.wav".'];
    const report = buildReport(data);
    expect(report.recording.fileName).toBeNull();
    for (const text of [reportToJson(report), reportToCsv(report), reportToHtml(report)]) {
      expect(text).not.toContain("take one");
    }
    expect(reportFileName(report, "json")).toBe("recording-report.json");
  });

  it("uses the name when allowed, made safe for a file system", async () => {
    const report = buildReport(await input());
    expect(reportFileName(report, "csv")).toBe("take-one-report.csv");
  });
});

describe("JSON export", () => {
  it("round-trips", async () => {
    const report = buildReport(await input());
    expect(JSON.parse(reportToJson(report)).timeDomain[0].channel).toBe("Mono");
  });
});

describe("CSV export", () => {
  const rows = (csv: string) => csv.trim().split("\r\n");

  it("has one measurement per row with a unit", async () => {
    const csv = reportToCsv(buildReport(await input()));
    expect(rows(csv)[0]).toBe("section,subject,metric,value,unit");
    const rms = rows(csv).find((r) => r.startsWith("time domain,Mono,rms,"))!;
    expect(rms.endsWith(",dBFS")).toBe(true);
    expect(Number(rms.split(",")[3])).toBeCloseTo(-9.03, 2);
  });

  it("gives every row the same number of columns", async () => {
    const csv = reportToCsv(buildReport(await input()));
    for (const row of rows(csv)) {
      expect(row.replace(/"[^"]*"/g, "x").split(",").length).toBe(5);
    }
  });

  it("omits values that do not exist", async () => {
    const data = await input();
    data.amplitude![0].measurement = { ...data.amplitude![0].measurement, crestFactorDb: null };
    expect(reportToCsv(buildReport(data))).not.toContain("crest factor");
  });

  it("quotes commas and quotes", async () => {
    const data = await input();
    data.recording.original.name = 'a, "b".wav';
    expect(reportToCsv(buildReport(data))).toContain('"a, ""b"".wav"');
  });

  it("neutralises text a spreadsheet would run as a formula", async () => {
    const data = await input();
    data.recording.original.name = "=HYPERLINK(1).wav";
    const csv = reportToCsv(buildReport(data));
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toContain(",=HYPERLINK");
  });

  it("does not guard negative numbers", async () => {
    expect(reportToCsv(buildReport(await input()))).toContain(",rms,-9.");
  });
});

describe("printable HTML", () => {
  it("escapes a hostile file name", async () => {
    const data = await input();
    data.recording.original.name = '<script>alert("x")</script>.wav';
    const html = reportToHtml(buildReport(data));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes warnings too", async () => {
    const data = await input();
    data.recording.warnings = ["<img src=x onerror=alert(1)>"];
    expect(reportToHtml(buildReport(data))).not.toContain("<img");
  });

  it("stands alone: no scripts and no external requests", async () => {
    const html = reportToHtml(buildReport(await input()));
    expect(html).not.toMatch(/<script|<link|src=|https?:/i);
  });

  it("contains every required section", async () => {
    const html = reportToHtml(buildReport(await input()));
    for (const heading of [
      "Recording",
      "File metadata",
      "Time-domain measurements",
      "Frequency-domain measurements",
      "Spectral characteristics",
      "Channel analysis",
      "Silence regions",
      "Clipping analysis",
      "Methodology",
      "Limitations",
    ]) {
      expect(html).toContain(`<h2>${heading}</h2>`);
    }
  });

  it("plots the curve inside the chart area", async () => {
    const html = reportToHtml(buildReport(await input()));
    const points = html.match(/<polyline points="([^"]+)"/)![1].split(" ");
    for (const point of points) {
      const y = Number(point.split(",")[1]);
      expect(y).toBeGreaterThanOrEqual(6);
      expect(y).toBeLessThanOrEqual(178);
    }
  });

  it("says plainly when stereo does not apply", async () => {
    expect(reportToHtml(buildReport(await input()))).toContain("need exactly two channels");
  });
});

describe("stored settings", () => {
  it("accepts valid preferences", () => {
    const raw = JSON.stringify({ fftSize: 4096, windowFunction: "blackman", rolloffPercent: 90 });
    expect(parseStoredSettings(raw)).toEqual({
      fftSize: 4096,
      windowFunction: "blackman",
      rolloffPercent: 90,
    });
  });

  it("drops invalid values and keeps the rest", () => {
    const raw = JSON.stringify({ fftSize: 1000, colorMap: "magma", rolloffPercent: 500 });
    expect(parseStoredSettings(raw)).toEqual({ colorMap: "magma" });
  });

  it("ignores keys it does not know", () => {
    expect(parseStoredSettings(JSON.stringify({ channel: 1, secret: "x" }))).toEqual({});
  });

  it.each(["not json", "null", "[]", "3", ""])("survives %j", (raw) => {
    expect(parseStoredSettings(raw)).toEqual({});
  });

  it("handles nothing stored", () => {
    expect(parseStoredSettings(null)).toEqual({});
  });
});
