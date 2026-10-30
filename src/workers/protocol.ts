import type { FilterConfiguration } from "@/core/dsp/filters";
import type {
  ChannelAmplitude,
  ChannelSelection,
  ChannelSignal,
  ComparisonNormalisation,
  ComparisonResult,
  NoiseResult,
  NoveltyResult,
  OffsetEstimate,
  PitchTrack,
  RecordingScan,
  SampleRange,
  SilenceOptions,
  SilenceResult,
  SpectrogramResult,
  SpectrumResult,
  StereoResult,
  TempoResult,
  WaveformPyramid,
  WindowFunction,
} from "@/types/analysis";

export interface RenderedFilter {
  /** A copy for playback; the worker keeps its own for measurements. */
  channels: Float32Array[];
  peakDb: number | null;
  rmsDb: number | null;
  /** Samples beyond ±1, which an output would clip. */
  overRangeSamples: number;
}

export interface JobRequests {
  waveform: Record<string, never>;
  amplitude: { range: SampleRange; labels: string[] };
  spectrum: {
    range: SampleRange;
    channel: ChannelSelection;
    fftSize: number;
    windowFunction: WindowFunction;
  };
  spectrogram: {
    channel: ChannelSelection;
    fftSize: number;
    hopSize: number;
    windowFunction: WindowFunction;
  };
  spectrogramDetail: {
    channel: ChannelSelection;
    fftSize: number;
    hopSize: number;
    windowFunction: WindowFunction;
    range: SampleRange;
  };
  signal: { range: SampleRange; labels: string[] };
  scan: { labels: string[] };
  silence: SilenceOptions;
  stereo: { range: SampleRange };
  filter: { filters: FilterConfiguration[] };
  processedSpectrum: {
    range: SampleRange;
    channel: ChannelSelection;
    fftSize: number;
    windowFunction: WindowFunction;
  };
  offset: Record<string, never>;
  novelty: { channel: ChannelSelection };
  /** Uses the curve from the last novelty job, between these times. */
  tempo: { startSeconds: number; endSeconds: number };
  pitch: { channel: ChannelSelection };
  noise: { range: SampleRange; channel: ChannelSelection };
  compare: {
    /** B's start on A's timeline, in seconds. */
    offsetSeconds: number;
    /** Limits the comparison, on A's timeline. */
    selection: { start: number; end: number } | null;
    normalisation: ComparisonNormalisation;
    fftSize: number;
    windowFunction: WindowFunction;
    rolloffPercent: number;
  };
}

export interface JobResults {
  waveform: WaveformPyramid[];
  amplitude: ChannelAmplitude[];
  spectrum: SpectrumResult;
  spectrogram: SpectrogramResult;
  spectrogramDetail: SpectrogramResult;
  signal: ChannelSignal[];
  scan: RecordingScan;
  silence: SilenceResult;
  stereo: StereoResult | null;
  filter: RenderedFilter;
  processedSpectrum: SpectrumResult;
  offset: OffsetEstimate;
  novelty: NoveltyResult;
  tempo: TempoResult;
  pitch: PitchTrack;
  noise: NoiseResult & { zeroCrossingRate: number | null };
  /** null when the two recordings do not overlap under the requested alignment. */
  compare: ComparisonResult | null;
}

export type JobKind = keyof JobRequests;

export type JobMessage = {
  [K in JobKind]: { type: "job"; id: number; kind: K; request: JobRequests[K] };
}[JobKind];

export type WorkerRequest =
  | { type: "load"; channels: Float32Array[]; sampleRate: number }
  | { type: "clear" }
  | { type: "loadReference"; channels: Float32Array[]; sampleRate: number }
  | { type: "clearReference" }
  | { type: "clearProcessed" }
  | { type: "cancel"; id: number }
  | JobMessage;

export type WorkerResponse =
  | { type: "progress"; id: number; value: number }
  | { type: "done"; id: number; result: JobResults[JobKind] }
  | { type: "cancelled"; id: number }
  | { type: "error"; id: number; message: string };
