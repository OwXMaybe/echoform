import { METRIC_DOCS, type MetricId } from "@/core/analysis/metric-docs";
import type { FilterConfiguration } from "@/core/dsp/filters";
import type {
  ChannelAmplitude,
  ClippingResult,
  ComparisonResult,
  NoiseResult,
  OnsetEvent,
  PitchSummary,
  SilenceResult,
  SpectralDescriptors,
  SpectralPeak,
  SpectrumResult,
  StereoResult,
  TempoResult,
} from "@/types/analysis";
import type { AudioRecording } from "@/types/audio";

export const REPORT_SCHEMA_VERSION = 1;

export interface ReportConfiguration {
  fftSize: number;
  hopSize: number;
  windowFunction: string;
  channel: string;
  rolloffPercent: number;
  peakProminenceDb: number;
  silenceThresholdDb: number;
  silenceMinSeconds: number;
  silencePaddingSeconds: number;
  dcWarningThreshold: number;
}

/** Everything a report may draw on, as already computed. Nothing here is recomputed. */
export interface ReportInput {
  recording: AudioRecording;
  generatedAt: string;
  includeFileNames: boolean;
  scope: { start: number; end: number; selected: boolean };
  band: { min: number; max: number } | null;
  configuration: ReportConfiguration;
  amplitude: ChannelAmplitude[] | null;
  spectrum: SpectrumResult | null;
  peaks: SpectralPeak[];
  descriptors: SpectralDescriptors | null;
  stereo: StereoResult | null;
  silence: SilenceResult | null;
  clipping: ClippingResult | null;
  filters: {
    list: FilterConfiguration[];
    rendered: { peakDb: number | null; rmsDb: number | null; overRangeSamples: number } | null;
  };
  comparison: {
    referenceName: string;
    alignment: string;
    offsetSeconds: number;
    match: number | null;
    result: ComparisonResult;
  } | null;
  events: {
    onsets: OnsetEvent[];
    sensitivity: number;
    tempo: TempoResult | null;
    pitch: PitchSummary | null;
    noise: (NoiseResult & { zeroCrossingRate: number | null }) | null;
  } | null;
}

export interface ReportMethod {
  title: string;
  kind: string;
  formula: string | null;
  meaning: string;
}

export interface AnalysisReport {
  schemaVersion: number;
  application: string;
  generatedAt: string;
  recording: {
    fileName: string | null;
    durationSeconds: number;
    sampleRate: number;
    channelCount: number;
    channelLabels: string[];
    frameCount: number;
    resampled: boolean;
  };
  file: {
    format: string;
    encoding: string | null;
    sizeBytes: number;
    sampleRate: number | null;
    channelCount: number | null;
    bitDepth: number | null;
  };
  warnings: string[];
  scope: {
    kind: "whole recording" | "selection";
    startSeconds: number;
    endSeconds: number;
    band: { minHz: number; maxHz: number } | null;
  };
  configuration: ReportConfiguration;
  timeDomain: Array<{
    channel: string;
    peakDbfs: number | null;
    rmsDbfs: number | null;
    crestFactorDb: number | null;
    mean: number;
    maxPositive: number;
    maxNegative: number;
    samplesAtFullScale: number;
    sampleCount: number;
  }> | null;
  frequencyDomain: {
    fftSize: number;
    windowFunction: string;
    frequencyResolutionHz: number;
    framesAveraged: number;
    zeroPadded: boolean;
    peaks: SpectralPeak[];
  } | null;
  /** Downsampled for charts: frequency and level pairs. */
  spectrumCurve: { frequencyHz: number[]; levelDb: number[] } | null;
  spectral: (SpectralDescriptors & { zeroCrossingRate: number | null }) | null;
  channelAnalysis: Omit<
    StereoResult,
    "correlationOverTime" | "correlationBlockSeconds" | "vectorscope" | "vectorscopeSize"
  > | null;
  silence: {
    regions: SilenceResult["regions"];
    silentSeconds: number;
    ratio: number;
    options: SilenceResult["options"];
  } | null;
  clipping: ClippingResult | null;
  filters: {
    list: Array<Omit<FilterConfiguration, "id">>;
    processedPeakDbfs: number | null;
    processedRmsDbfs: number | null;
    samplesOverFullScale: number;
  } | null;
  comparison: {
    referenceFileName: string | null;
    alignmentMethod: string;
    offsetSeconds: number;
    alignmentMatch: number | null;
    comparedSeconds: number;
    startInA: number;
    startInB: number;
    normalisation: string;
    gainOnBDb: number;
    differenceRmsDb: number | null;
    a: ComparisonResult["a"];
    b: ComparisonResult["b"];
  } | null;
  events: {
    onsetSensitivity: number;
    onsetSeconds: number[];
    tempo: TempoResult | null;
    pitch: PitchSummary | null;
    noise: NoiseResult | null;
  } | null;
  methodology: ReportMethod[];
  limitations: string[];
}

const LIMITATIONS = [
  "Levels are digital sample measurements: not LUFS, not true peak, and not calibrated to acoustic sound pressure.",
  "Decoded audio comes from the browser's decoder. Lossy formats describe the decoded signal, not the original performance.",
  "Clipping analysis finds samples at digital full scale. It cannot detect analog distortion or clipping that was later turned down.",
  "Spectrum resolution and leakage depend on FFT size and window, which are listed under configuration.",
  "Estimates in the events section were validated on synthetic signals. They are not transcriptions, and may not suit every recording.",
];

const CURVE_POINTS = 240;
const CURVE_MIN_HZ = 20;

/** The strongest bin in each of a fixed number of log-spaced bands. */
function curveOf(spectrum: SpectrumResult): AnalysisReport["spectrumCurve"] {
  const binHz = spectrum.frequencyResolution;
  const nyquist = spectrum.sampleRate / 2;
  const ratio = nyquist / CURVE_MIN_HZ;
  const frequencyHz: number[] = [];
  const levelDb: number[] = [];
  for (let p = 0; p < CURVE_POINTS; p++) {
    const f0 = CURVE_MIN_HZ * Math.pow(ratio, p / CURVE_POINTS);
    const f1 = CURVE_MIN_HZ * Math.pow(ratio, (p + 1) / CURVE_POINTS);
    const b0 = Math.round(f0 / binHz);
    const b1 = Math.min(spectrum.levelDb.length - 1, Math.max(b0, Math.round(f1 / binHz) - 1));
    let best = -Infinity;
    for (let b = b0; b <= b1; b++) if (spectrum.levelDb[b] > best) best = spectrum.levelDb[b];
    if (best === -Infinity) continue;
    frequencyHz.push(Math.sqrt(f0 * f1));
    levelDb.push(best);
  }
  return { frequencyHz, levelDb };
}

function method(id: MetricId): ReportMethod {
  const doc = METRIC_DOCS[id];
  return {
    title: doc.title,
    kind: doc.kind,
    formula: "formula" in doc ? doc.formula : null,
    meaning: doc.meaning,
  };
}

function methodsFor(input: ReportInput): ReportMethod[] {
  const ids: MetricId[] = ["peak", "rms", "crest", "clipping", "spectrum", "peaks"];
  if (input.descriptors) ids.push("centroid", "rolloff", "flatness");
  if (input.silence) ids.push("silence");
  if (input.stereo) ids.push("midSide", "correlation", "stereoWidth");
  if (input.filters.list.length > 0) ids.push("filterResponse");
  if (input.comparison) ids.push("alignment", "normalisation", "spectralDifference");
  if (input.events) ids.push("onsets", "tempo", "pitch", "noiseFloor");
  return ids.map(method);
}

/** The figures, without the per-block and per-sample arrays behind the charts. */
function stereoSummary(s: StereoResult): NonNullable<AnalysisReport["channelAnalysis"]> {
  return {
    sampleCount: s.sampleCount,
    leftRmsDb: s.leftRmsDb,
    rightRmsDb: s.rightRmsDb,
    leftPeakDb: s.leftPeakDb,
    rightPeakDb: s.rightPeakDb,
    levelDifferenceDb: s.levelDifferenceDb,
    correlation: s.correlation,
    midRmsDb: s.midRmsDb,
    sideRmsDb: s.sideRmsDb,
    midPeakDb: s.midPeakDb,
    sidePeakDb: s.sidePeakDb,
    sideToMidDb: s.sideToMidDb,
    width: s.width,
  };
}

export function buildReport(input: ReportInput): AnalysisReport {
  const { recording, stereo, spectrum, descriptors, silence, comparison, events } = input;
  const { original, decoded } = recording;
  const enabled = input.filters.list.filter((f) => f.enabled);
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    application: "ECHOFORM",
    generatedAt: input.generatedAt,
    recording: {
      fileName: input.includeFileNames ? original.name : null,
      durationSeconds: decoded.duration,
      sampleRate: decoded.sampleRate,
      channelCount: decoded.channelCount,
      channelLabels: decoded.channelLabels,
      frameCount: decoded.frameCount,
      resampled: decoded.resampled,
    },
    file: {
      format: original.formatLabel,
      encoding: original.encoding ?? null,
      sizeBytes: original.sizeBytes,
      sampleRate: original.sampleRate,
      channelCount: original.channelCount,
      bitDepth: original.bitDepth,
    },
    warnings: input.includeFileNames
      ? recording.warnings
      : recording.warnings.map((w) => w.split(original.name).join("[file name withheld]")),
    scope: {
      kind: input.scope.selected ? "selection" : "whole recording",
      startSeconds: input.scope.start,
      endSeconds: input.scope.end,
      band: input.band ? { minHz: input.band.min, maxHz: input.band.max } : null,
    },
    configuration: input.configuration,
    timeDomain:
      input.amplitude?.map(({ label, measurement: m }) => ({
        channel: label,
        peakDbfs: m.peakDbfs,
        rmsDbfs: m.rmsDbfs,
        crestFactorDb: m.crestFactorDb,
        mean: m.mean,
        maxPositive: m.maxPositive,
        maxNegative: m.maxNegative,
        samplesAtFullScale: m.clippedSamples,
        sampleCount: m.sampleCount,
      })) ?? null,
    frequencyDomain: spectrum && {
      fftSize: spectrum.fftSize,
      windowFunction: spectrum.windowFunction,
      frequencyResolutionHz: spectrum.frequencyResolution,
      framesAveraged: spectrum.framesAveraged,
      zeroPadded: spectrum.zeroPadded,
      peaks: input.peaks,
    },
    spectrumCurve: spectrum && curveOf(spectrum),
    spectral: descriptors && {
      ...descriptors,
      zeroCrossingRate: events?.noise?.zeroCrossingRate ?? null,
    },
    channelAnalysis: stereo && stereoSummary(stereo),
    silence: silence && {
      regions: silence.regions,
      silentSeconds: silence.silentSeconds,
      ratio: silence.ratio,
      options: silence.options,
    },
    clipping: input.clipping,
    filters:
      enabled.length === 0
        ? null
        : {
            list: enabled.map(({ filterType, frequency, q, gainDb, order, enabled: on }) => ({
              filterType,
              frequency,
              q,
              gainDb,
              order,
              enabled: on,
            })),
            processedPeakDbfs: input.filters.rendered?.peakDb ?? null,
            processedRmsDbfs: input.filters.rendered?.rmsDb ?? null,
            samplesOverFullScale: input.filters.rendered?.overRangeSamples ?? 0,
          },
    comparison: comparison && {
      referenceFileName: input.includeFileNames ? comparison.referenceName : null,
      alignmentMethod: comparison.alignment,
      offsetSeconds: comparison.offsetSeconds,
      alignmentMatch: comparison.match,
      comparedSeconds: comparison.result.seconds,
      startInA: comparison.result.startA,
      startInB: comparison.result.startB,
      normalisation: comparison.result.normalisation,
      gainOnBDb: comparison.result.gainDb,
      differenceRmsDb: comparison.result.differenceRmsDb,
      a: comparison.result.a,
      b: comparison.result.b,
    },
    events: events && {
      onsetSensitivity: events.sensitivity,
      onsetSeconds: events.onsets.map((o) => o.time),
      tempo: events.tempo,
      pitch: events.pitch,
      noise: events.noise,
    },
    methodology: methodsFor(input),
    limitations: LIMITATIONS,
  };
}

export const reportToJson = (report: AnalysisReport): string => JSON.stringify(report, null, 2);

function csvCell(value: string | number): string {
  if (typeof value === "number") return String(value);
  // A leading sign would run as a formula when a spreadsheet opens the file.
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** One measurement per row. A value that does not exist is left out, never written as zero. */
export function reportToCsv(report: AnalysisReport): string {
  const rows: Array<[string, string, string, string | number, string]> = [];
  const add = (
    section: string,
    subject: string,
    metric: string,
    value: string | number | null | undefined,
    unit = "",
  ) => {
    if (value !== null && value !== undefined) rows.push([section, subject, metric, value, unit]);
  };
  const { recording: r, file, scope, configuration } = report;
  add("recording", "", "file name", r.fileName);
  add("recording", "", "duration", r.durationSeconds, "s");
  add("recording", "", "sample rate", r.sampleRate, "Hz");
  add("recording", "", "channels", r.channelCount);
  add("recording", "", "samples", r.frameCount);
  add("file", "", "format", file.format);
  add("file", "", "size", file.sizeBytes, "bytes");
  add("file", "", "sample rate", file.sampleRate, "Hz");
  add("file", "", "bit depth", file.bitDepth, "bit");
  add("scope", "", "kind", scope.kind);
  add("scope", "", "start", scope.startSeconds, "s");
  add("scope", "", "end", scope.endSeconds, "s");
  for (const [key, value] of Object.entries(configuration)) add("configuration", "", key, value);
  for (const c of report.timeDomain ?? []) {
    add("time domain", c.channel, "peak", c.peakDbfs, "dBFS");
    add("time domain", c.channel, "rms", c.rmsDbfs, "dBFS");
    add("time domain", c.channel, "crest factor", c.crestFactorDb, "dB");
    add("time domain", c.channel, "mean", c.mean);
    add("time domain", c.channel, "samples at full scale", c.samplesAtFullScale);
  }
  report.frequencyDomain?.peaks.forEach((peak, i) => {
    const subject = `peak ${i + 1}`;
    add("frequency domain", subject, "frequency", peak.frequencyHz, "Hz");
    add("frequency domain", subject, "level", peak.levelDb, "dB");
    add("frequency domain", subject, "prominence", peak.prominenceDb, "dB");
  });
  const s = report.spectral;
  add("spectral", "", "centroid", s?.centroidHz, "Hz");
  add("spectral", "", "rolloff", s?.rolloffHz, "Hz");
  add("spectral", "", "flatness", s?.flatness);
  add("spectral", "", "zero-crossing rate", s?.zeroCrossingRate, "per s");
  const c = report.channelAnalysis;
  add("channels", "", "correlation", c?.correlation);
  add("channels", "", "level difference", c?.levelDifferenceDb, "dB");
  add("channels", "", "mid rms", c?.midRmsDb, "dBFS");
  add("channels", "", "side rms", c?.sideRmsDb, "dBFS");
  add("channels", "", "width index", c?.width);
  report.silence?.regions.forEach((region, i) => {
    add("silence", `region ${i + 1}`, "start", region.start, "s");
    add("silence", `region ${i + 1}`, "end", region.end, "s");
    add("silence", `region ${i + 1}`, "kind", region.kind);
  });
  add("silence", "", "silent time", report.silence?.silentSeconds, "s");
  add("silence", "", "ratio", report.silence?.ratio);
  add("clipping", "", "samples", report.clipping?.clippedSamples);
  add("clipping", "", "intervals", report.clipping?.totalIntervals);
  report.clipping?.intervals.forEach((interval, i) => {
    add("clipping", `interval ${i + 1}`, "start", interval.start, "s");
    add("clipping", `interval ${i + 1}`, "end", interval.end, "s");
    add("clipping", `interval ${i + 1}`, "channels", interval.channels.join(" "));
  });
  report.filters?.list.forEach((f, i) => {
    add("filters", `filter ${i + 1}`, "type", f.filterType);
    add("filters", `filter ${i + 1}`, "frequency", f.frequency, "Hz");
    add("filters", `filter ${i + 1}`, "q", f.q);
    add("filters", `filter ${i + 1}`, "gain", f.gainDb, "dB");
    add("filters", `filter ${i + 1}`, "order", f.order);
  });
  const m = report.comparison;
  if (m) {
    add("comparison", "", "alignment", m.alignmentMethod);
    add("comparison", "", "offset", m.offsetSeconds, "s");
    add("comparison", "", "compared time", m.comparedSeconds, "s");
    add("comparison", "", "difference rms", m.differenceRmsDb, "dBFS");
    for (const [side, metrics] of [["A", m.a], ["B", m.b]] as const) {
      add("comparison", side, "peak", metrics.peakDb, "dBFS");
      add("comparison", side, "rms", metrics.rmsDb, "dBFS");
      add("comparison", side, "centroid", metrics.centroidHz, "Hz");
      add("comparison", side, "rolloff", metrics.rolloffHz, "Hz");
      add("comparison", side, "zero-crossing rate", metrics.zeroCrossingRate, "per s");
    }
  }
  const e = report.events;
  add("events", "", "onsets", e?.onsetSeconds.length);
  add("events", "", "tempo", e?.tempo?.bpm, "BPM");
  add("events", "", "tempo confidence", e?.tempo?.confidence);
  add("events", "", "median pitch", e?.pitch?.medianHz, "Hz");
  add("events", "", "noise floor estimate", e?.noise?.noiseFloorDb, "dBFS");
  add("events", "", "snr estimate", e?.noise?.snrDb, "dB");
  const header = "section,subject,metric,value,unit";
  return [header, ...rows.map((row) => row.map(csvCell).join(","))].join("\r\n") + "\r\n";
}

/** A file name that names the recording only when the report does. */
export function reportFileName(report: AnalysisReport, extension: string): string {
  const base = report.recording.fileName?.replace(/\.[^.]+$/, "") ?? "recording";
  const safe = base.replace(/[^\p{L}\p{N}._-]+/gu, "-");
  return `${safe}-report.${extension}`;
}
