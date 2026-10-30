"use client";

import { ImageDown, Loader2 } from "lucide-react";
import { useRef } from "react";
import { spectrogramColumnAt } from "@/core/dsp/stft";
import { colorMapLut } from "@/core/visualization/color-maps";
import {
  CHART,
  CHART_FONT,
  drawFrequencyBandY,
  drawTimeAxis,
  drawTimeOverlay,
  timePlotArea,
  timeToX,
} from "@/core/visualization/plot";
import {
  fractionToFrequency,
  frequencyTicks,
  frequencyToFraction,
  viewFrequencyAxis as frequencyAxisFor,
} from "@/core/visualization/scales";
import { useCanvasRenderer } from "@/hooks/use-canvas-renderer";
import { useTimelineInteraction } from "@/hooks/use-timeline-interaction";
import {
  audioStore,
  cancelSpectrogram,
  runSpectrogram,
  visibleSpectrogram,
} from "@/stores/audio-store";
import { useStore } from "@/stores/create-store";
import { channelSelectionLabel } from "@/types/analysis";
import { playback, playbackStore } from "@/stores/playback-store";
import { selectionStore } from "@/stores/selection-store";
import { settingsStore } from "@/stores/settings-store";
import { chartFileName, saveCanvasesAsPng } from "@/utils/export-image";
import { formatAxisHz, formatDb, formatHz, formatTimePrecise } from "@/utils/formatting";

const BASE_STORES = [audioStore, settingsStore, selectionStore];
const OVERLAY_STORES = [selectionStore, playbackStore, settingsStore, audioStore];

export function SpectrogramViewer() {
  const container = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const isPlaying = useStore(playbackStore, (s) => s.isPlaying);
  const regionTool = useStore(settingsStore, (s) => s.regionTool);
  const status = useStore(audioStore, (s) => s.status.spectrogram);
  const progress = useStore(audioStore, (s) => s.progress.spectrogram);
  const hasData = useStore(audioStore, (s) => s.spectrogram !== null);

  useCanvasRenderer(
    base,
    (ctx, width, height, dpr) => {
      ctx.fillStyle = CHART.background;
      ctx.fillRect(0, 0, width, height);
      const { view } = selectionStore.get();
      const g = visibleSpectrogram(view);
      if (!g) return;
      const settings = settingsStore.get();
      const axis = frequencyAxisFor(g.sampleRate, settings);
      const area = timePlotArea(width, height);
      const w = Math.max(1, Math.round(area.width * dpr));
      const h = Math.max(1, Math.round(area.height * dpr));

      const binsPerHz = 1 / g.frequencyResolution;
      const rowLow = new Int32Array(h);
      const rowHigh = new Int32Array(h);
      for (let y = 0; y < h; y++) {
        const f0 = fractionToFrequency(1 - (y + 1) / h, axis);
        const f1 = fractionToFrequency(1 - y / h, axis);
        const b0 = Math.min(g.bins - 1, Math.round(f0 * binsPerHz));
        rowLow[y] = b0;
        rowHigh[y] = Math.max(b0, Math.min(g.bins - 1, Math.round(f1 * binsPerHz) - 1));
      }

      const lut = colorMapLut(settings.colorMap);
      const top = audioStore.get().spectrogram?.maxDb ?? g.maxDb;
      const floor = top - settings.dynamicRangeDb;
      const gain = 255 / settings.dynamicRangeDb;
      const image = ctx.createImageData(w, h);
      const pixels = new Uint32Array(image.data.buffer);
      const span = view.end - view.start;
      for (let x = 0; x < w; x++) {
        const c0 = spectrogramColumnAt(g, view.start + (x / w) * span);
        const c1 = Math.max(c0, spectrogramColumnAt(g, view.start + ((x + 1) / w) * span) - 1);
        for (let y = 0; y < h; y++) {
          let best = -Infinity;
          for (let c = c0; c <= c1; c++) {
            const offset = c * g.bins;
            for (let b = rowLow[y]; b <= rowHigh[y]; b++) {
              const value = g.data[offset + b];
              if (value > best) best = value;
            }
          }
          const index = (best - floor) * gain;
          pixels[y * w + x] = lut[index <= 0 ? 0 : index >= 255 ? 255 : index | 0];
        }
      }
      ctx.putImageData(image, Math.round(area.left * dpr), Math.round(area.top * dpr));

      ctx.font = CHART_FONT;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      let lastY = Infinity;
      for (const hz of frequencyTicks(axis)) {
        const y = area.top + area.height * (1 - frequencyToFraction(hz, axis));
        if (lastY - y < 16) continue;
        lastY = y;
        ctx.fillStyle = CHART.axis;
        ctx.fillRect(area.left - 4, Math.round(y), 4, 1);
        ctx.fillStyle = CHART.label;
        ctx.fillText(formatAxisHz(hz), area.left - 6, y);
      }
      ctx.save();
      ctx.translate(11, area.top + area.height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center";
      ctx.fillText("Frequency (Hz)", 0, 0);
      ctx.restore();
      drawTimeAxis(ctx, area, view);
    },
    {
      stores: BASE_STORES,
      dependencies: () => {
        const { view } = selectionStore.get();
        const s = settingsStore.get();
        return [
          visibleSpectrogram(view),
          audioStore.get().spectrogram?.maxDb,
          view,
          s.colorMap,
          s.dynamicRangeDb,
          s.frequencyScale,
          s.viewMinHz,
          s.viewMaxHz,
        ];
      },
    },
  );

  useCanvasRenderer(
    overlay,
    (ctx, width, height) => {
      ctx.clearRect(0, 0, width, height);
      const { view, time, frequency } = selectionStore.get();
      const { spectrogram: g } = audioStore.get();
      if (view.end <= view.start || !g) return;
      const area = timePlotArea(width, height);
      if (frequency && time) {
        const axis = frequencyAxisFor(g.sampleRate, settingsStore.get());
        const toY = (hz: number) => area.top + area.height * (1 - frequencyToFraction(hz, axis));
        const x0 = timeToX(time.start, view, area);
        const x1 = timeToX(time.end, view, area);
        ctx.strokeStyle = CHART.selectionEdge;
        ctx.strokeRect(x0, toY(frequency.max), x1 - x0, toY(frequency.min) - toY(frequency.max));
      } else if (frequency) {
        const axis = frequencyAxisFor(g.sampleRate, settingsStore.get());
        drawFrequencyBandY(ctx, area, frequency, (hz) =>
          area.top + area.height * (1 - frequencyToFraction(hz, axis)),
        );
      }
      drawTimeOverlay(ctx, area, view, time, playback.position());
    },
    { stores: OVERLAY_STORES, animate: isPlaying },
  );

  const yToFrequency = (y: number, height: number) => {
    const { spectrogram: g } = audioStore.get();
    if (!g) return 0;
    const area = timePlotArea(0, height);
    const fraction = 1 - Math.max(0, Math.min(1, (y - area.top) / area.height));
    return fractionToFrequency(fraction, frequencyAxisFor(g.sampleRate, settingsStore.get()));
  };

  useTimelineInteraction(container, {
    regionTool,
    yToFrequency,
    onHover: (point) => {
      const element = tooltip.current;
      const { spectrogramChannel, recording } = audioStore.get();
      const g = visibleSpectrogram(selectionStore.get().view);
      if (!element) return;
      if (!point || !g || !recording) {
        element.hidden = true;
        return;
      }
      const hz = yToFrequency(point.y, container.current?.clientHeight ?? 1);
      const col = spectrogramColumnAt(g, point.time);
      const bin = Math.min(g.bins - 1, Math.round(hz / g.frequencyResolution));
      const channel = channelSelectionLabel(spectrogramChannel ?? "mix", recording.decoded.channelLabels);
      element.hidden = false;
      element.textContent = `${formatTimePrecise(point.time)}  ·  ${formatHz(bin * g.frequencyResolution)}  ·  ${formatDb(g.data[col * g.bins + bin], "dB")}  ·  ${channel}`;
      const width = container.current?.clientWidth ?? 0;
      const left = point.x > width - 280 ? point.x - 270 : point.x + 14;
      element.style.transform = `translate(${left}px, ${Math.max(6, point.y - 30)}px)`;
    },
  });

  const save = () => {
    if (!base.current || !overlay.current) return;
    const name = audioStore.get().recording?.original.name;
    saveCanvasesAsPng([base.current, overlay.current], chartFileName(name, "spectrogram"));
  };

  return (
    <div
      ref={container}
      className="relative h-full min-h-48 cursor-crosshair touch-none select-none overflow-hidden"
      data-testid="spectrogram"
    >
      <canvas
        ref={base}
        role="img"
        aria-label="Spectrogram. Time runs left to right, frequency bottom to top, colour shows level."
        className="absolute inset-0 h-full w-full"
      />
      <canvas ref={overlay} className="absolute inset-0 h-full w-full" />
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
      {status === "running" && (
        <div className="absolute right-12 top-2 flex items-center gap-2 rounded border border-line bg-deep/90 px-2 py-1 text-xs tabular-nums">
          <Loader2 className="size-3.5 animate-spin text-accent" aria-hidden />
          Computing {Math.round(progress * 100)}%
          <button
            type="button"
            onClick={cancelSpectrogram}
            className="text-muted underline hover:text-ink"
          >
            Cancel
          </button>
        </div>
      )}
      {(status === "cancelled" || status === "error") && (
        <div className="absolute right-12 top-2 flex items-center gap-2 rounded border border-line bg-deep/90 px-2 py-1 text-xs">
          {status === "error"
            ? "The spectrogram could not be computed."
            : hasData
              ? "Update cancelled. Showing the previous result."
              : "Spectrogram cancelled."}
          <button
            type="button"
            onClick={() => runSpectrogram(true)}
            className="text-accent underline"
          >
            Run again
          </button>
        </div>
      )}
    </div>
  );
}
