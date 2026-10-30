import { computeDescriptors } from "@/core/dsp/descriptors";
import { DEFAULT_PEAK_OPTIONS, detectPeaks } from "@/core/dsp/peaks";
import { summarisePitch } from "@/core/dsp/pitch";
import type { ReportInput } from "@/core/reports/report";
import { channelSelectionLabel } from "@/types/analysis";
import { audioStore } from "./audio-store";
import { alignmentOffset, comparisonStore, type AlignmentMethod } from "./comparison-store";
import { filterStore } from "./filter-store";
import { insightsStore } from "./insights-store";
import { selectionStore } from "./selection-store";
import { settingsStore } from "./settings-store";

const ALIGNMENT_NAMES: Record<AlignmentMethod, string> = {
  start: "File starts aligned",
  end: "File ends aligned",
  manual: "Manual offset",
  estimated: "Cross-correlation estimate",
};

/** Gathers what the stores currently hold. It never starts a measurement. */
export function collectReportInput(): ReportInput | null {
  const audio = audioStore.get();
  const { recording, spectrum } = audio;
  if (!recording) return null;
  const settings = settingsStore.get();
  const { time, frequency } = selectionStore.get();
  const filters = filterStore.get();
  const compare = comparisonStore.get();
  const insights = insightsStore.get();
  const { duration, channelLabels } = recording.decoded;
  const scope = { start: time?.start ?? 0, end: time?.end ?? duration, selected: time !== null };

  const peaks = spectrum
    ? detectPeaks(spectrum.levelDb, spectrum.sampleRate, spectrum.fftSize, {
        ...DEFAULT_PEAK_OPTIONS,
        minProminenceDb: settings.peakProminenceDb,
        minHz: frequency?.min,
        maxHz: frequency?.max,
      })
    : [];
  const descriptors = spectrum
    ? computeDescriptors(spectrum.levelDb, spectrum.sampleRate, spectrum.fftSize, {
        windowFunction: spectrum.windowFunction,
        rolloffPercent: settings.rolloffPercent,
        minHz: frequency?.min,
        maxHz: frequency?.max,
      })
    : null;

  return {
    recording,
    generatedAt: new Date().toISOString(),
    includeFileNames: settings.reportIncludeFileNames,
    scope,
    band: frequency,
    configuration: {
      fftSize: settings.fftSize,
      hopSize: settings.fftSize / settings.hopDivisor,
      windowFunction: settings.windowFunction,
      channel: channelSelectionLabel(settings.channel, channelLabels),
      rolloffPercent: settings.rolloffPercent,
      peakProminenceDb: settings.peakProminenceDb,
      silenceThresholdDb: settings.silenceThresholdDb,
      silenceMinSeconds: settings.silenceMinSeconds,
      silencePaddingSeconds: settings.silencePaddingSeconds,
      dcWarningThreshold: settings.dcWarningThreshold,
    },
    amplitude: audio.amplitude,
    spectrum,
    peaks,
    descriptors,
    stereo: audio.stereo,
    silence: audio.silence,
    clipping: audio.scan?.clipping ?? null,
    filters: { list: filters.filters, rendered: filters.rendered },
    comparison:
      compare.reference && compare.result
        ? {
            referenceName: compare.reference.name,
            alignment: ALIGNMENT_NAMES[compare.alignment],
            offsetSeconds: alignmentOffset(compare, duration),
            match: compare.alignment === "estimated" ? (compare.estimate?.coefficient ?? null) : null,
            result: compare.result,
          }
        : null,
    events: insights.novelty
      ? {
          onsets: insights.onsets,
          sensitivity: insights.sensitivity,
          tempo: insights.tempo,
          pitch: insights.pitch ? summarisePitch(insights.pitch, scope.start, scope.end) : null,
          noise: insights.noise,
        }
      : null,
  };
}

/** Names of the measurements a report is still waiting for. */
export function pendingMeasurements(): string[] {
  const audio = audioStore.get();
  const { status, recording } = audio;
  if (!recording) return [];
  const insights = insightsStore.get();
  const compare = comparisonStore.get();
  const waiting = (value: unknown, kind: keyof typeof status) =>
    value === null && status[kind] !== "error" && status[kind] !== "cancelled";
  const checks: Array<[boolean, string]> = [
    [waiting(audio.amplitude, "amplitude"), "levels"],
    [waiting(audio.spectrum, "spectrum"), "spectrum"],
    [waiting(audio.silence, "silence"), "silence"],
    [waiting(audio.scan, "scan"), "clipping"],
    [recording.decoded.channelCount === 2 && waiting(audio.stereo, "stereo"), "stereo"],
    [waiting(insights.novelty, "novelty"), "onsets"],
    [waiting(insights.tempo, "tempo"), "tempo"],
    [waiting(insights.pitch, "pitch"), "pitch"],
    [waiting(insights.noise, "noise"), "noise"],
    [status.filter === "running", "filters"],
    [status.compare === "running", "comparison"],
    [compare.reference !== null && status.compare === "idle", "comparison"],
    [
      Object.values(status).some((s) => s === "running") &&
        (status.amplitude === "running" || status.spectrum === "running"),
      "the current selection",
    ],
  ];
  return [...new Set(checks.filter(([pending]) => pending).map(([, name]) => name))];
}
