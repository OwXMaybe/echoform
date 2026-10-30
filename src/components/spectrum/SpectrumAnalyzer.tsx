"use client";

import { ImageDown } from "lucide-react";
import { useEffect, useRef } from "react";
import { DEFAULT_PEAK_OPTIONS, detectPeaks } from "@/core/dsp/peaks";
import { DB_FLOOR, FrameAnalyzer, powerToDb } from "@/core/dsp/spectrum";
import {
  drawFrequencyAxes,
  frequencyPlotArea as spectrumArea,
  traceBinCurve,
} from "@/core/visualization/frequency-plot";
import { CHART, CHART_FONT } from "@/core/visualization/plot";
import {
  fractionToFrequency,
  frequencyToFraction,
  viewFrequencyAxis as frequencyAxisFor,
} from "@/core/visualization/scales";
import { useCanvasRenderer } from "@/hooks/use-canvas-renderer";
import { useSpectralDescriptors } from "@/hooks/use-spectral-descriptors";
import { useSpectralPeaks } from "@/hooks/use-spectral-peaks";
import { audioStore, getAudioBuffer } from "@/stores/audio-store";
import { useStore } from "@/stores/create-store";
import { playback, playbackStore } from "@/stores/playback-store";
import { selectionStore, setFrequencySelection } from "@/stores/selection-store";
import { settingsStore } from "@/stores/settings-store";
import type { SpectralDescriptors, SpectralPeak } from "@/types/analysis";
import { chartFileName, saveCanvasesAsPng } from "@/utils/export-image";
import { formatDb, formatHz } from "@/utils/formatting";

const STORES = [audioStore, settingsStore, selectionStore, playbackStore];

/** Computes the spectrum of one frame at the playhead on demand, from the real PCM. */
class LiveSpectrum {
  private analyzer: FrameAnalyzer | null = null;
  private key = "";
  private power = new Float64Array(0);
  private smoothed = new Float64Array(0);
  private scratch = new Float32Array(0);
  private level = new Float32Array(0);

  compute(buffer: AudioBuffer, position: number): Float32Array {
    const { fftSize, windowFunction, channel, liveSmoothing } = settingsStore.get();
    const key = `${fftSize}|${windowFunction}`;
    if (key !== this.key) {
      this.key = key;
      this.analyzer = new FrameAnalyzer(fftSize, windowFunction);
      this.power = new Float64Array(this.analyzer.bins);
      this.smoothed = new Float64Array(this.analyzer.bins);
      this.scratch = new Float32Array(fftSize);
      this.level = new Float32Array(this.analyzer.bins);
    }
    const start = Math.round(position * buffer.sampleRate) - (fftSize >> 1);
    this.scratch.fill(0);
    const sources =
      typeof channel === "number"
        ? [buffer.getChannelData(channel)]
        : Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    sources.forEach((source, index) => {
      const sign = channel === "side" && index === 1 ? -1 : 1;
      for (let i = 0; i < fftSize; i++) {
        const p = start + i;
        if (p >= 0 && p < source.length) this.scratch[i] += (sign * source[p]) / sources.length;
      }
    });
    this.power.fill(0);
    this.analyzer!.addFrame(this.scratch, 0, this.power);
    for (let k = 0; k < this.power.length; k++) {
      this.smoothed[k] = liveSmoothing * this.smoothed[k] + (1 - liveSmoothing) * this.power[k];
      this.level[k] = powerToDb(this.smoothed[k]);
    }
    return this.level;
  }
}

export function SpectrumAnalyzer({ markers = false }: { markers?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const live = useRef<LiveSpectrum | null>(null);
  const drag = useRef<number | null>(null);
  const shown = useRef<Float32Array | null>(null);
  const scopePeaks = useSpectralPeaks();
  const descriptors = useSpectralDescriptors();
  const descriptorsRef = useRef<SpectralDescriptors | null>(descriptors);
  const peaksRef = useRef<SpectralPeak[]>(scopePeaks);
  const isPlaying = useStore(playbackStore, (s) => s.isPlaying);
  const source = useStore(settingsStore, (s) => s.spectrumSource);

  useEffect(() => {
    peaksRef.current = scopePeaks;
    descriptorsRef.current = descriptors;
  }, [scopePeaks, descriptors]);

  useCanvasRenderer(
    canvas,
    (ctx, width, height) => {
      ctx.fillStyle = CHART.background;
      ctx.fillRect(0, 0, width, height);
      const { spectrum, recording } = audioStore.get();
      const settings = settingsStore.get();
      const buffer = getAudioBuffer();
      if (!recording || !buffer) return;
      const sampleRate = recording.decoded.sampleRate;
      const axis = frequencyAxisFor(sampleRate, settings);
      const area = spectrumArea(width, height);
      const floor = -settings.dynamicRangeDb;
      const toX = (hz: number) => area.left + frequencyToFraction(hz, axis) * area.width;

      const toY = drawFrequencyAxes(ctx, area, axis, floor, 0, "Level (dB re full-scale sine)");

      const followPlayhead = settings.spectrumSource === "playhead";
      let level: Float32Array | null;
      let fftSize: number;
      if (followPlayhead) {
        live.current ??= new LiveSpectrum();
        level = live.current.compute(buffer, playback.position());
        fftSize = settings.fftSize;
      } else {
        level = spectrum?.levelDb ?? null;
        fftSize = spectrum?.fftSize ?? settings.fftSize;
      }
      shown.current = level;
      if (!level) return;

      const binHz = sampleRate / fftSize;
      const { frequency } = selectionStore.get();
      ctx.save();
      ctx.beginPath();
      ctx.rect(area.left, area.top, area.width, area.height);
      ctx.clip();
      if (frequency) {
        const x0 = toX(frequency.min);
        const x1 = toX(frequency.max);
        ctx.fillStyle = CHART.selection;
        ctx.fillRect(x0, area.top, x1 - x0, area.height);
      }
      traceBinCurve(ctx, area, axis, level, binHz, toY, DB_FLOOR);
      ctx.strokeStyle = CHART.spectrum;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.stroke();

      if (markers && !followPlayhead) {
        const { centroidHz, rolloffHz } = descriptorsRef.current ?? {};
        ctx.font = CHART_FONT;
        ctx.textBaseline = "top";
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = CHART.label;
        const marker = (hz: number | null | undefined, label: string, row: number) => {
          if (!hz || hz < axis.min || hz > axis.max) return;
          const x = Math.round(toX(hz)) + 0.5;
          ctx.beginPath();
          ctx.moveTo(x, area.top);
          ctx.lineTo(x, area.top + area.height);
          ctx.stroke();
          const flip = x > area.left + area.width - 90;
          ctx.textAlign = flip ? "right" : "left";
          ctx.fillStyle = CHART.label;
          ctx.fillText(label, x + (flip ? -5 : 5), area.top + area.height - 16 - row * 14);
        };
        marker(centroidHz, "Centroid", 0);
        marker(rolloffHz, "Rolloff", 1);
        ctx.setLineDash([]);
      }

      const peaks = followPlayhead
        ? detectPeaks(level, sampleRate, fftSize, {
            ...DEFAULT_PEAK_OPTIONS,
            minProminenceDb: settings.peakProminenceDb,
            minHz: frequency?.min,
            maxHz: frequency?.max,
          })
        : peaksRef.current;
      ctx.font = CHART_FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      peaks.slice(0, 8).forEach((peak, index) => {
        if (peak.frequencyHz < axis.min || peak.frequencyHz > axis.max) return;
        const x = toX(peak.frequencyHz);
        const y = toY(peak.levelDb);
        ctx.fillStyle = CHART.background;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = CHART.playhead;
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        if (index < 5) {
          ctx.fillStyle = CHART.label;
          ctx.fillText(formatHz(peak.frequencyHz), x, Math.max(area.top + 12, y - 8));
        }
      });
      ctx.restore();
    },
    { stores: STORES, animate: source === "playhead" && isPlaying },
  );

  const locate = (clientX: number, clientY: number) => {
    const element = container.current!;
    const rect = element.getBoundingClientRect();
    const area = spectrumArea(rect.width, rect.height);
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const sampleRate = audioStore.get().recording?.decoded.sampleRate ?? 48000;
    const axis = frequencyAxisFor(sampleRate, settingsStore.get());
    const fraction = Math.max(0, Math.min(1, (x - area.left) / area.width));
    return { x, y, hz: fractionToFrequency(fraction, axis), sampleRate, width: rect.width };
  };

  const save = () => {
    if (!canvas.current) return;
    const name = audioStore.get().recording?.original.name;
    saveCanvasesAsPng([canvas.current], chartFileName(name, "spectrum"));
  };

  return (
    <div
      ref={container}
      className="relative h-full min-h-48 cursor-crosshair touch-none select-none overflow-hidden"
      data-testid="spectrum"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = locate(event.clientX, event.clientY).hz;
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerLeave={() => {
        if (tooltip.current) tooltip.current.hidden = true;
      }}
      onPointerMove={(event) => {
        const { x, y, hz, sampleRate, width } = locate(event.clientX, event.clientY);
        if (drag.current !== null && Math.abs(hz - drag.current) > 0) {
          setFrequencySelection(drag.current, hz);
        }
        const element = tooltip.current;
        const level = shown.current;
        if (!element || !level) return;
        const fftSize = (level.length - 1) * 2;
        const bin = Math.min(level.length - 1, Math.round((hz * fftSize) / sampleRate));
        element.hidden = false;
        element.textContent = `${formatHz((bin * sampleRate) / fftSize)}  ·  ${formatDb(level[bin], "dB")}`;
        const left = x > width - 170 ? x - 160 : x + 14;
        element.style.transform = `translate(${left}px, ${Math.max(6, y - 30)}px)`;
      }}
    >
      <canvas
        ref={canvas}
        role="img"
        aria-label="Frequency spectrum. Drag to select a frequency range."
        className="absolute inset-0 h-full w-full"
      />
      <button
        type="button"
        aria-label="Save as PNG"
        title="Save as PNG"
        onClick={save}
        onPointerDown={(event) => event.stopPropagation()}
        className="absolute right-4 top-2 z-10 rounded border border-line bg-deep/80 p-1 text-muted hover:text-ink"
      >
        <ImageDown className="size-3.5" aria-hidden />
      </button>      <div
        ref={tooltip}
        hidden
        className="pointer-events-none absolute left-0 top-0 whitespace-pre rounded border border-line bg-deep/95 px-1.5 py-0.5 text-[11px] tabular-nums"
      />
    </div>
  );
}
