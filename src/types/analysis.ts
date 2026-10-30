export const FFT_SIZES = [256, 512, 1024, 2048, 4096, 8192, 16384] as const;
export type FftSize = (typeof FFT_SIZES)[number];

export const WINDOW_FUNCTIONS = ["rectangular", "hann", "hamming", "blackman"] as const;
export type WindowFunction = (typeof WINDOW_FUNCTIONS)[number];

export type FrequencyScale = "log" | "linear";

/**
 * A channel index, "mix" for the equal-weight average of every channel (for stereo this is the
 * mid signal), or "side" for (L - R) / 2 of a two-channel recording.
 */
export type ChannelSelection = number | "mix" | "side";

export function channelSelectionLabel(
  selection: ChannelSelection,
  labels: readonly string[] | null | undefined,
): string {
  if (selection === "side") return "Side";
  if (selection === "mix") return labels?.length === 2 ? "Mid (mix)" : "Mix";
  return labels?.[selection] ?? "";
}

export interface AnalysisConfiguration {
  fftSize: FftSize;
  hopSize: number;
  windowFunction: WindowFunction;
  frequencyScale: FrequencyScale;
  channel: ChannelSelection;
}

export interface SampleRange {
  start: number;
  end: number;
}

/** Raw amplitude measurements of one channel over one sample range. */
export interface AmplitudeMeasurement {
  sampleCount: number;
  maxPositive: number;
  maxNegative: number;
  peak: number;
  mean: number;
  rms: number;
  /** null when the signal is exactly zero: a level in dB is undefined there. */
  peakDbfs: number | null;
  rmsDbfs: number | null;
  /** peak / rms, null for digital silence. */
  crestFactor: number | null;
  crestFactorDb: number | null;
  clippedSamples: number;
}

export interface ChannelAmplitude {
  label: string;
  measurement: AmplitudeMeasurement;
}

export interface SpectrumResult {
  /** Amplitude-calibrated level per bin, dB re full-scale sine. Length fftSize / 2 + 1. */
  levelDb: Float32Array;
  sampleRate: number;
  fftSize: number;
  windowFunction: WindowFunction;
  frequencyResolution: number;
  framesAveraged: number;
  /** Set when the range was shorter than fftSize and was zero-padded. */
  analysedSamples: number;
  zeroPadded: boolean;
}

export interface SpectralPeak {
  frequencyHz: number;
  levelDb: number;
  prominenceDb: number;
  band: string;
}

export interface PeakDetectionOptions {
  minProminenceDb: number;
  minDistanceHz: number;
  minLevelDb: number;
  maxPeaks: number;
  minHz?: number;
  maxHz?: number;
}

export interface SpectrogramResult {
  /** Column-major dB values: value(col, bin) = data[col * bins + bin]. */
  data: Float32Array;
  columns: number;
  bins: number;
  sampleRate: number;
  fftSize: number;
  hopSize: number;
  /** Time of column 0's centre; 0 unless only part of the recording was analysed. */
  startSeconds: number;
  /** Consecutive STFT frames power-averaged into one column (1 unless memory-capped). */
  framesPerColumn: number;
  windowFunction: WindowFunction;
  frequencyResolution: number;
  timeResolution: number;
  maxDb: number;
}

export interface WaveformLevel {
  blockSize: number;
  min: Float32Array;
  max: Float32Array;
}

export type WaveformPyramid = WaveformLevel[];

/** Measurements of one time-frequency box, taken from the spectrogram's own cells. */
export interface RegionMeasurement {
  /** RMS-equivalent level of the band, averaged over the time range; null without energy. */
  bandLevelDb: number | null;
  peakDb: number | null;
  peakSeconds: number;
  peakHz: number;
  columns: number;
  bins: number;
}

/** All null when the analysed band holds no energy. */
export interface SpectralDescriptors {
  centroidHz: number | null;
  rolloffHz: number | null;
  /** Geometric mean / arithmetic mean of power, 0..1. */
  flatness: number | null;
  flatnessDb: number | null;
}

export interface SilenceOptions {
  thresholdDb: number;
  minDurationSeconds: number;
  paddingSeconds: number;
}

export interface SilenceRegion {
  start: number;
  end: number;
  duration: number;
  peakDb: number | null;
  kind: "digital-silence" | "low-level";
}

export interface SilenceResult {
  regions: SilenceRegion[];
  options: SilenceOptions;
  frameSeconds: number;
  silentSeconds: number;
  ratio: number;
}

export interface ClippingInterval {
  start: number;
  end: number;
  clippedSamples: number;
  channels: string[];
}

export interface ClippingResult {
  intervals: ClippingInterval[];
  /** May exceed intervals.length: the list is capped. */
  totalIntervals: number;
  clippedSamples: number;
}

export interface SampleHistogram {
  counts: Uint32Array;
  overRange: number;
}

export interface LevelHistogram {
  counts: Uint32Array;
  minDb: number;
  binDb: number;
}

export interface DynamicsResult {
  histogram: LevelHistogram;
  blocks: number;
  gatedBlocks: number;
  p10Db: number | null;
  p50Db: number | null;
  p95Db: number | null;
  /** p95 - p10 of gated short-term levels; ECHOFORM's own definition, not EBU LRA. */
  rangeDb: number | null;
}

/** Scope-dependent distributions for one channel. */
export interface ChannelSignal {
  label: string;
  histogram: SampleHistogram;
  dynamics: DynamicsResult;
}

/** Whole-recording scan, independent of any selection. */
export interface RecordingScan {
  blockSeconds: number;
  /** Short-term dBFS per channel. */
  levels: Float32Array[];
  clipping: ClippingResult;
}

/** Two-channel measurements over one sample range. */
export interface StereoResult {
  sampleCount: number;
  leftRmsDb: number | null;
  rightRmsDb: number | null;
  leftPeakDb: number | null;
  rightPeakDb: number | null;
  /** Left RMS minus right RMS. */
  levelDifferenceDb: number | null;
  /** -1..1 at zero lag; null when either channel is silent. */
  correlation: number | null;
  midRmsDb: number | null;
  sideRmsDb: number | null;
  midPeakDb: number | null;
  sidePeakDb: number | null;
  sideToMidDb: number | null;
  /** Side power as a fraction of mid + side power: 0 mono, 0.5 uncorrelated, 1 out of phase. */
  width: number | null;
  /** One value per block; NaN where a channel is silent. */
  correlationOverTime: Float32Array;
  correlationBlockSeconds: number;
  /** Sample counts by side (x) and mid (y), row-major with mid = -1 first. */
  vectorscope: Uint32Array;
  vectorscopeSize: number;
}

export interface WaveformEnvelope {
  min: Float32Array;
  max: Float32Array;
}

export interface OffsetEstimate {
  offsetSeconds: number;
  /** Normalised correlation at the chosen lag; null when a signal has no energy. */
  coefficient: number | null;
  resolutionSeconds: number;
  analysedSeconds: number;
}

export type ComparisonNormalisation = "none" | "rms" | "peak";

/** One recording's side of a comparison, over the compared interval. */
export interface ComparisonMetrics {
  duration: number;
  sampleRate: number;
  channelCount: number;
  /** The largest peak of any channel. */
  peakDb: number | null;
  /** Mean power across channels. */
  rmsDb: number | null;
  crestDb: number | null;
  centroidHz: number | null;
  rolloffHz: number | null;
  flatness: number | null;
  zeroCrossingRate: number | null;
  /** null unless the recording has exactly two channels with signal in both. */
  correlation: number | null;
  dynamicRangeDb: number | null;
}

export interface ComparisonResult {
  a: ComparisonMetrics;
  b: ComparisonMetrics;
  /** Compared interval on each recording's own timeline, in seconds. */
  startA: number;
  startB: number;
  seconds: number;
  normalisation: ComparisonNormalisation;
  /** Applied to B in the overlaid spectrum and waveform difference; metrics stay unscaled. */
  gainDb: number;
  gridHz: Float32Array;
  levelA: Float32Array;
  levelB: Float32Array;
  waveformA: WaveformEnvelope;
  waveformB: WaveformEnvelope;
  /** null when the sample rates differ: samples then do not correspond. */
  difference: WaveformEnvelope | null;
  differenceRmsDb: number | null;
}

/** Onset strength per analysis frame, scaled so the strongest frame is 1. */
export interface NoveltyResult {
  novelty: Float32Array;
  hopSeconds: number;
  /** Added to a frame's start time to place an event. */
  frameOffsetSeconds: number;
}

export interface OnsetEvent {
  time: number;
  strength: number;
}

export interface OnsetPicks {
  events: OnsetEvent[];
  threshold: Float32Array;
}

export interface TempoCandidate {
  bpm: number;
  /** Normalised autocorrelation at this period, 0..1. */
  periodicity: number;
  relation: "best" | "double" | "half" | "three-halves" | "two-thirds" | "triple" | "third" | "other";
}

export interface TempoResult {
  /** null when there is no clear tempo; candidates may still be listed. */
  bpm: number | null;
  confidence: number;
  candidates: TempoCandidate[];
  reason: string | null;
}

export interface PitchTrack {
  /** Hz per frame; NaN where no reliable pitch exists. */
  frequency: Float32Array;
  /** YIN's normalised difference at the chosen period, per frame: 0 periodic, 1 not. */
  aperiodicity: Float32Array;
  hopSeconds: number;
  /** Time of frame 0. */
  startSeconds: number;
  /** Upper limit of the audio the tracker sees. */
  analysedHz: number;
}

export interface PitchSummary {
  medianHz: number | null;
  /** Share of frames in the range with a reliable pitch. */
  voicedRatio: number;
  harmonicToNoiseDb: number | null;
  frames: number;
}

export interface HarmonicRow {
  number: number;
  expectedHz: number;
  /** All null when no distinct peak exists near the expected frequency. */
  measuredHz: number | null;
  levelDb: number | null;
  relativeDb: number | null;
  deviationCents: number | null;
}

export interface HarmonicResult {
  fundamentalHz: number;
  rows: HarmonicRow[];
  /** False when the FFT is too coarse to separate harmonics of this fundamental. */
  resolvable: boolean;
}

export interface HumIndicator {
  frequencyHz: number;
  levelDb: number;
  prominenceDb: number;
}

export interface NoiseResult {
  /** null unless quiet and loud frames separate enough to read one as background. */
  noiseFloorDb: number | null;
  signalLevelDb: number | null;
  snrDb: number | null;
  quietestDb: number | null;
  /** Share of non-silent frames within 3 dB of the quietest level. */
  quietShare: number;
  /** The longest run of near-floor frames, in seconds. */
  interval: { start: number; end: number } | null;
  confidence: "moderate" | "low" | "none";
  reason: string | null;
  hum: HumIndicator[];
}

/** Cooperative progress and cancellation hook used by long-running analysis. */
export interface JobControl {
  checkpoint(progress: number): Promise<void> | void;
}

export const NO_CONTROL: JobControl = { checkpoint: () => undefined };
