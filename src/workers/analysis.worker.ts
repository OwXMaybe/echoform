import { measureAmplitude } from "@/core/dsp/amplitude";
import { detectClipping } from "@/core/dsp/clipping";
import {
  estimateOffset,
  logFrequencyGrid,
  spectrumOnGrid,
  waveformDifference,
  waveformEnvelope,
  zeroCrossingRate,
} from "@/core/dsp/comparison";
import { computeDescriptors } from "@/core/dsp/descriptors";
import {
  analyseDynamics,
  sampleHistogram,
  SHORT_TERM_SECONDS,
  shortTermLevels,
} from "@/core/dsp/dynamics";
import { applySections, chainSections } from "@/core/dsp/filters";
import { estimateNoise } from "@/core/dsp/noise";
import { computeNovelty } from "@/core/dsp/onset";
import { trackPitch } from "@/core/dsp/pitch";
import { detectSilence } from "@/core/dsp/silence";
import { computeAverageSpectrum } from "@/core/dsp/spectrum";
import { analyseStereo, sideSignal } from "@/core/dsp/stereo";
import { computeSpectrogram } from "@/core/dsp/stft";
import { estimateTempo } from "@/core/dsp/tempo";
import { buildWaveformPyramid } from "@/core/dsp/waveform";
import type {
  ChannelSelection,
  ComparisonMetrics,
  JobControl,
  NoveltyResult,
  SampleRange,
} from "@/types/analysis";
import type {
  JobMessage,
  JobRequests,
  JobResults,
  WorkerRequest,
  WorkerResponse,
} from "./protocol";

const YIELD_INTERVAL_MS = 30;
const MAX_DETAIL_CELLS = 6_000_000;
const COMPARISON_GRID_POINTS = 480;
const COMPARISON_MIN_HZ = 20;
const COMPARISON_COLUMNS = 1200;

class Cancelled extends Error {}

/** A loaded recording and the signals derived from it on demand. */
class Source {
  private mix: Float32Array | null = null;
  private side: Float32Array | null = null;

  constructor(
    readonly channels: Float32Array[],
    readonly sampleRate: number,
  ) {}

  data(selection: ChannelSelection): Float32Array {
    if (selection === "side") {
      if (this.channels.length !== 2) return this.channels[0];
      this.side ??= sideSignal(this.channels[0], this.channels[1]);
      return this.side;
    }
    if (selection !== "mix") return this.channels[selection] ?? this.channels[0];
    if (this.channels.length === 1) return this.channels[0];
    if (!this.mix) {
      const mix = new Float32Array(this.channels[0].length);
      const weight = 1 / this.channels.length;
      for (const channel of this.channels) {
        for (let i = 0; i < mix.length; i++) mix[i] += channel[i] * weight;
      }
      this.mix = mix;
    }
    return this.mix;
  }
}

let source = new Source([], 0);
let processed: Source | null = null;
let reference: Source | null = null;
let lastNovelty: NoveltyResult | null = null;
const cancelled = new Set<number>();

const post = (message: WorkerResponse, transfer: Transferable[] = []) =>
  self.postMessage(message, { transfer });

/** Yields to the event loop so cancel messages can land while a job runs. */
function controlFor(id: number, offset = 0, scale = 1): JobControl {
  let last = performance.now();
  return {
    checkpoint: async (progress) => {
      const now = performance.now();
      if (now - last < YIELD_INTERVAL_MS) return;
      post({ type: "progress", id, value: offset + progress * scale });
      await new Promise((resolve) => setTimeout(resolve));
      last = performance.now();
      if (cancelled.has(id)) throw new Cancelled();
    },
  };
}

async function comparisonMetrics(
  recording: Source,
  range: SampleRange,
  request: JobRequests["compare"],
  control: JobControl,
): Promise<{ metrics: ComparisonMetrics; levelDb: Float32Array; gridFftSize: number }> {
  const { channels, sampleRate } = recording;
  const mono = recording.data("mix");
  const { fftSize, windowFunction, rolloffPercent } = request;
  const spectrum = await computeAverageSpectrum(
    mono,
    sampleRate,
    range,
    fftSize,
    windowFunction,
    control,
  );
  const descriptors = computeDescriptors(spectrum.levelDb, sampleRate, fftSize, {
    windowFunction,
    rolloffPercent,
  });
  const amplitudes = channels.map((channel) => measureAmplitude(channel, range));
  const peak = Math.max(...amplitudes.map((a) => a.peak));
  const power = amplitudes.reduce((sum, a) => sum + a.rms * a.rms, 0) / channels.length;
  const blockSize = Math.round(sampleRate * SHORT_TERM_SECONDS);
  const dynamics = analyseDynamics(await shortTermLevels(mono, blockSize, range, control));
  const stereo =
    channels.length === 2 ? await analyseStereo(channels[0], channels[1], sampleRate, range) : null;
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : null;
  const rmsDb = power > 0 ? 10 * Math.log10(power) : null;
  return {
    levelDb: spectrum.levelDb,
    gridFftSize: fftSize,
    metrics: {
      duration: channels[0].length / sampleRate,
      sampleRate,
      channelCount: channels.length,
      peakDb,
      rmsDb,
      crestDb: peakDb !== null && rmsDb !== null ? peakDb - rmsDb : null,
      centroidHz: descriptors.centroidHz,
      rolloffHz: descriptors.rolloffHz,
      flatness: descriptors.flatness,
      zeroCrossingRate: zeroCrossingRate(mono, sampleRate, range),
      correlation: stereo?.correlation ?? null,
      dynamicRangeDb: dynamics.rangeDb,
    },
  };
}

async function compare(
  request: JobRequests["compare"],
  id: number,
): Promise<JobResults["compare"]> {
  const b = reference;
  if (!b) return null;
  const a = source;
  const durationA = a.channels[0].length / a.sampleRate;
  const durationB = b.channels[0].length / b.sampleRate;
  const { offsetSeconds, selection, normalisation } = request;
  // Everything is expressed on A's timeline, where B occupies offset .. offset + durationB.
  const start = Math.max(0, offsetSeconds, selection?.start ?? 0);
  const end = Math.min(durationA, offsetSeconds + durationB, selection?.end ?? Infinity);
  if (end - start <= 0) return null;
  const rangeA = {
    start: Math.round(start * a.sampleRate),
    end: Math.round(end * a.sampleRate),
  };
  const startB = Math.round((start - offsetSeconds) * b.sampleRate);
  const rangeB = {
    start: startB,
    end: Math.min(b.channels[0].length, startB + Math.round((end - start) * b.sampleRate)),
  };

  const sideA = await comparisonMetrics(a, rangeA, request, controlFor(id, 0, 0.4));
  const sideB = await comparisonMetrics(b, rangeB, request, controlFor(id, 0.4, 0.4));
  const gainDb =
    normalisation === "none" || sideA.metrics.rmsDb === null || sideB.metrics.rmsDb === null
      ? 0
      : normalisation === "rms"
        ? sideA.metrics.rmsDb - sideB.metrics.rmsDb
        : sideA.metrics.peakDb! - sideB.metrics.peakDb!;
  const gain = Math.pow(10, gainDb / 20);

  const maxHz = Math.min(a.sampleRate, b.sampleRate) / 2;
  const gridHz = logFrequencyGrid(COMPARISON_MIN_HZ, maxHz, COMPARISON_GRID_POINTS);
  const monoA = a.data("mix");
  const monoB = b.data("mix");
  const sameRate = a.sampleRate === b.sampleRate;
  let difference = null;
  let differenceRmsDb = null;
  if (sameRate) {
    const compared = {
      start: rangeA.start,
      end: rangeA.start + Math.min(rangeA.end - rangeA.start, rangeB.end - rangeB.start),
    };
    const result = await waveformDifference(
      monoA,
      compared,
      monoB,
      rangeB.start,
      gain,
      COMPARISON_COLUMNS,
      controlFor(id, 0.8, 0.2),
    );
    difference = result.envelope;
    differenceRmsDb = result.rmsDb;
  }
  return {
    a: sideA.metrics,
    b: sideB.metrics,
    startA: start,
    startB: start - offsetSeconds,
    seconds: end - start,
    normalisation,
    gainDb,
    gridHz,
    levelA: spectrumOnGrid(sideA.levelDb, a.sampleRate, sideA.gridFftSize, gridHz),
    levelB: spectrumOnGrid(sideB.levelDb, b.sampleRate, sideB.gridFftSize, gridHz),
    waveformA: waveformEnvelope(monoA, rangeA, COMPARISON_COLUMNS),
    waveformB: waveformEnvelope(monoB, rangeB, COMPARISON_COLUMNS, gain),
    difference,
    differenceRmsDb,
  };
}

async function run(message: JobMessage): Promise<{ result: JobResults[keyof JobResults]; transfer: Transferable[] }> {
  const control = controlFor(message.id);
  const { channels, sampleRate } = source;
  const channelData = (selection: ChannelSelection) => source.data(selection);
  switch (message.kind) {
    case "waveform": {
      const result = [];
      for (let c = 0; c < channels.length; c++) {
        const scale = 1 / channels.length;
        result.push(await buildWaveformPyramid(channels[c], controlFor(message.id, c * scale, scale)));
      }
      const transfer = result.flat().flatMap((l) => [l.min.buffer, l.max.buffer]);
      return { result, transfer };
    }
    case "amplitude": {
      const { range, labels } = message.request;
      const result = channels.map((channel, i) => ({
        label: labels[i],
        measurement: measureAmplitude(channel, range),
      }));
      return { result, transfer: [] };
    }
    case "spectrum": {
      const { range, channel, fftSize, windowFunction } = message.request;
      const result = await computeAverageSpectrum(
        channelData(channel),
        sampleRate,
        range,
        fftSize,
        windowFunction,
        control,
      );
      return { result, transfer: [result.levelDb.buffer] };
    }
    case "spectrogram": {
      const { channel, fftSize, hopSize, windowFunction } = message.request;
      const result = await computeSpectrogram(
        channelData(channel),
        sampleRate,
        fftSize,
        hopSize,
        windowFunction,
        control,
      );
      return { result, transfer: [result.data.buffer] };
    }
    case "spectrogramDetail": {
      const { channel, fftSize, hopSize, windowFunction, range } = message.request;
      const result = await computeSpectrogram(
        channelData(channel),
        sampleRate,
        fftSize,
        hopSize,
        windowFunction,
        control,
        MAX_DETAIL_CELLS,
        range,
      );
      return { result, transfer: [result.data.buffer] };
    }
    case "signal": {
      const { range, labels } = message.request;
      const blockSize = Math.round(sampleRate * SHORT_TERM_SECONDS);
      const result = [];
      for (let c = 0; c < channels.length; c++) {
        const levels = await shortTermLevels(channels[c], blockSize, range, control);
        result.push({
          label: labels[c],
          histogram: sampleHistogram(channels[c], range),
          dynamics: analyseDynamics(levels),
        });
      }
      return { result, transfer: [] };
    }
    case "scan": {
      const blockSize = Math.round(sampleRate * SHORT_TERM_SECONDS);
      const levels = [];
      for (let c = 0; c < channels.length; c++) {
        const whole = { start: 0, end: channels[c].length };
        levels.push(await shortTermLevels(channels[c], blockSize, whole, control));
      }
      const clipping = await detectClipping(channels, sampleRate, message.request.labels, control);
      const result = { blockSeconds: blockSize / sampleRate, levels, clipping };
      return { result, transfer: levels.map((l) => l.buffer) };
    }
    case "silence": {
      const result = await detectSilence(channels, sampleRate, message.request, control);
      return { result, transfer: [] };
    }
    case "stereo": {
      if (channels.length !== 2) return { result: null, transfer: [] };
      const { range } = message.request;
      const result = await analyseStereo(channels[0], channels[1], sampleRate, range, control);
      return { result, transfer: [result.correlationOverTime.buffer, result.vectorscope.buffer] };
    }
    case "filter": {
      const sections = chainSections(message.request.filters, sampleRate);
      const rendered: Float32Array[] = [];
      let peak = 0;
      let sum = 0;
      let overRangeSamples = 0;
      for (let c = 0; c < channels.length; c++) {
        const scale = 1 / channels.length;
        const output = await applySections(
          channels[c],
          sections,
          controlFor(message.id, c * scale, scale),
        );
        for (let i = 0; i < output.length; i++) {
          const magnitude = Math.abs(output[i]);
          if (magnitude > peak) peak = magnitude;
          if (magnitude > 1) overRangeSamples++;
          sum += output[i] * output[i];
        }
        rendered.push(output);
      }
      processed = new Source(rendered, sampleRate);
      const copies = rendered.map((channel) => channel.slice());
      const power = sum / (channels.length * channels[0].length);
      const result = {
        channels: copies,
        peakDb: peak > 0 ? 20 * Math.log10(peak) : null,
        rmsDb: power > 0 ? 10 * Math.log10(power) : null,
        overRangeSamples,
      };
      return { result, transfer: copies.map((c) => c.buffer) };
    }
    case "processedSpectrum": {
      if (!processed) throw new Error("Nothing has been rendered.");
      const { range, channel, fftSize, windowFunction } = message.request;
      const result = await computeAverageSpectrum(
        processed.data(channel),
        sampleRate,
        range,
        fftSize,
        windowFunction,
        control,
      );
      return { result, transfer: [result.levelDb.buffer] };
    }
    case "novelty": {
      const result = await computeNovelty(channelData(message.request.channel), sampleRate, control);
      lastNovelty = { ...result, novelty: result.novelty.slice() };
      return { result, transfer: [result.novelty.buffer] };
    }
    case "tempo": {
      if (!lastNovelty) throw new Error("No onset curve yet.");
      const { novelty, hopSeconds } = lastNovelty;
      const { startSeconds, endSeconds } = message.request;
      const from = Math.max(0, Math.floor(startSeconds / hopSeconds));
      const to = Math.min(novelty.length, Math.ceil(endSeconds / hopSeconds));
      const result = await estimateTempo(novelty.subarray(from, to), hopSeconds, control);
      return { result, transfer: [] };
    }
    case "pitch": {
      const result = await trackPitch(channelData(message.request.channel), sampleRate, control);
      return { result, transfer: [result.frequency.buffer, result.aperiodicity.buffer] };
    }
    case "noise": {
      const { range, channel } = message.request;
      const samples = channelData(channel);
      const noise = await estimateNoise(samples, sampleRate, range, control);
      const result = { ...noise, zeroCrossingRate: zeroCrossingRate(samples, sampleRate, range) };
      return { result, transfer: [] };
    }
    case "offset": {
      if (!reference) throw new Error("No reference recording.");
      const result = await estimateOffset(
        source.data("mix"),
        sampleRate,
        reference.data("mix"),
        reference.sampleRate,
        control,
      );
      return { result, transfer: [] };
    }
    case "compare": {
      const result = await compare(message.request, message.id);
      if (!result) return { result, transfer: [] };
      const envelopes = [result.waveformA, result.waveformB, result.difference];
      const transfer: Transferable[] = [
        result.gridHz.buffer,
        result.levelA.buffer,
        result.levelB.buffer,
        ...envelopes.flatMap((e) => (e ? [e.min.buffer, e.max.buffer] : [])),
      ];
      return { result, transfer };
    }
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  switch (message.type) {
    case "load":
      source = new Source(message.channels, message.sampleRate);
      processed = null;
      lastNovelty = null;
      return;
    case "clear":
      source = new Source([], 0);
      processed = null;
      lastNovelty = null;
      reference = null;
      return;
    case "loadReference":
      reference = new Source(message.channels, message.sampleRate);
      return;
    case "clearProcessed":
      processed = null;
      return;
    case "clearReference":
      reference = null;
      return;
    case "cancel":
      cancelled.add(message.id);
      return;
    case "job":
      try {
        const { result, transfer } = await run(message);
        post({ type: "done", id: message.id, result }, transfer);
      } catch (error) {
        if (error instanceof Cancelled) post({ type: "cancelled", id: message.id });
        else post({ type: "error", id: message.id, message: "Analysis failed in the worker." });
      }
      cancelled.delete(message.id);
  }
};
