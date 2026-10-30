"use client";

import { useRef } from "react";
import { chainSections, filterSections, responseAt } from "@/core/dsp/filters";
import { DB_FLOOR } from "@/core/dsp/spectrum";
import {
  drawFrequencyAxes,
  frequencyPlotArea,
  frequencyToX,
  traceBinCurve,
} from "@/core/visualization/frequency-plot";
import { CHART } from "@/core/visualization/plot";
import { fractionToFrequency, viewFrequencyAxis } from "@/core/visualization/scales";
import { useCanvasRenderer } from "@/hooks/use-canvas-renderer";
import { audioStore } from "@/stores/audio-store";
import { useStore } from "@/stores/create-store";
import { filterStore } from "@/stores/filter-store";
import { settingsStore } from "@/stores/settings-store";
import { formatDb, formatHz } from "@/utils/formatting";

const RESPONSE_STORES = [filterStore, settingsStore, audioStore];
const SPECTRUM_STORES = [filterStore, settingsStore, audioStore];
const RESPONSE_MAX_DB = 30;
const RESPONSE_MIN_DB = -48;
const ORIGINAL_COLOR = CHART.label;

const axisFor = (sampleRate: number) => viewFrequencyAxis(sampleRate, settingsStore.get());

function useHoverTooltip(describe: (hz: number) => string | null) {
  const tooltip = useRef<HTMLDivElement>(null);
  return {
    tooltip,
    hoverProps: {
      onPointerLeave: () => {
        if (tooltip.current) tooltip.current.hidden = true;
      },
      onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
        const element = tooltip.current;
        const sampleRate = audioStore.get().recording?.decoded.sampleRate;
        if (!element || !sampleRate) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const area = frequencyPlotArea(rect.width, rect.height);
        const x = event.clientX - rect.left;
        const fraction = (x - area.left) / area.width;
        const text =
          fraction >= 0 && fraction <= 1
            ? describe(fractionToFrequency(fraction, axisFor(sampleRate)))
            : null;
        if (!text) {
          element.hidden = true;
          return;
        }
        element.hidden = false;
        element.textContent = text;
        const left = x > rect.width - 220 ? x - 210 : x + 14;
        element.style.transform = `translate(${left}px, 8px)`;
      },
    },
  };
}

function Tooltip({ element }: { element: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={element}
      hidden
      className="pointer-events-none absolute left-0 top-0 whitespace-pre rounded border border-line bg-deep/95 px-1.5 py-0.5 text-[11px] tabular-nums"
    />
  );
}

export function ResponseChart() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { tooltip, hoverProps } = useHoverTooltip((hz) => {
    const sampleRate = audioStore.get().recording?.decoded.sampleRate ?? 48000;
    const sections = chainSections(filterStore.get().filters, sampleRate);
    if (sections.length === 0) return null;
    const { magnitudeDb, phaseRadians } = responseAt(sections, hz, sampleRate);
    const degrees = (phaseRadians * 180) / Math.PI;
    return `${formatHz(hz)}  ·  ${formatDb(magnitudeDb, "dB")}  ·  ${degrees.toFixed(0).replace("-", "−")}°`;
  });

  useCanvasRenderer(
    canvas,
    (ctx, width, height) => {
      ctx.fillStyle = CHART.background;
      ctx.fillRect(0, 0, width, height);
      const sampleRate = audioStore.get().recording?.decoded.sampleRate;
      if (!sampleRate) return;
      const { filters } = filterStore.get();
      const axis = axisFor(sampleRate);
      const area = frequencyPlotArea(width, height);
      const toY = drawFrequencyAxes(
        ctx,
        area,
        axis,
        RESPONSE_MIN_DB,
        RESPONSE_MAX_DB,
        "Gain (dB)",
      );
      const enabled = filters.filter((f) => f.enabled);
      const trace = (sections: ReturnType<typeof chainSections>) => {
        ctx.beginPath();
        for (let px = 0; px <= area.width; px++) {
          const hz = fractionToFrequency(px / area.width, axis);
          const db = responseAt(sections, hz, sampleRate).magnitudeDb;
          const y = Math.max(area.top, Math.min(area.top + area.height, toY(db)));
          if (px === 0) ctx.moveTo(area.left, y);
          else ctx.lineTo(area.left + px, y);
        }
        ctx.stroke();
      };
      ctx.save();
      ctx.beginPath();
      ctx.rect(area.left, area.top, area.width, area.height);
      ctx.clip();
      ctx.lineJoin = "round";
      if (enabled.length > 1) {
        ctx.strokeStyle = CHART.axis;
        ctx.lineWidth = 1;
        for (const filter of enabled) trace(filterSections(filter, sampleRate));
      }
      ctx.strokeStyle = CHART.spectrum;
      ctx.lineWidth = 2;
      trace(chainSections(filters, sampleRate));
      ctx.fillStyle = CHART.playhead;
      for (const filter of enabled) {
        if (filter.frequency < axis.min || filter.frequency > axis.max) continue;
        const db = responseAt(chainSections(filters, sampleRate), filter.frequency, sampleRate);
        const x = frequencyToX(filter.frequency, axis, area);
        ctx.beginPath();
        ctx.arc(x, Math.max(area.top, toY(db.magnitudeDb)), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },
    { stores: RESPONSE_STORES },
  );

  return (
    <div
      role="img"
      aria-label="Frequency response of the enabled filters"
      data-testid="filter-response"
      className="relative h-56 touch-none"
      {...hoverProps}
    >
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      <Tooltip element={tooltip} />
    </div>
  );
}

export function ProcessedSpectrumChart() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const hasProcessed = useStore(filterStore, (s) => s.processedSpectrum !== null);
  const { tooltip, hoverProps } = useHoverTooltip((hz) => {
    const { spectrum } = audioStore.get();
    const { processedSpectrum } = filterStore.get();
    if (!spectrum) return null;
    const bin = Math.min(
      spectrum.levelDb.length - 1,
      Math.round(hz / spectrum.frequencyResolution),
    );
    const parts = [
      formatHz(bin * spectrum.frequencyResolution),
      `Original ${formatDb(spectrum.levelDb[bin], "dB")}`,
    ];
    if (processedSpectrum?.fftSize === spectrum.fftSize) {
      parts.push(`Processed ${formatDb(processedSpectrum.levelDb[bin], "dB")}`);
    }
    return parts.join("  ·  ");
  });

  useCanvasRenderer(
    canvas,
    (ctx, width, height) => {
      ctx.fillStyle = CHART.background;
      ctx.fillRect(0, 0, width, height);
      const { spectrum, recording } = audioStore.get();
      if (!recording) return;
      const settings = settingsStore.get();
      const axis = axisFor(recording.decoded.sampleRate);
      const area = frequencyPlotArea(width, height);
      const toY = drawFrequencyAxes(
        ctx,
        area,
        axis,
        -settings.dynamicRangeDb,
        0,
        "Level (dB re full-scale sine)",
      );
      const { processedSpectrum } = filterStore.get();
      ctx.save();
      ctx.beginPath();
      ctx.rect(area.left, area.top, area.width, area.height);
      ctx.clip();
      ctx.lineJoin = "round";
      if (spectrum) {
        traceBinCurve(ctx, area, axis, spectrum.levelDb, spectrum.frequencyResolution, toY, DB_FLOOR);
        ctx.strokeStyle = ORIGINAL_COLOR;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (processedSpectrum) {
        traceBinCurve(
          ctx,
          area,
          axis,
          processedSpectrum.levelDb,
          processedSpectrum.frequencyResolution,
          toY,
          DB_FLOOR,
        );
        ctx.strokeStyle = CHART.spectrum;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();
    },
    { stores: SPECTRUM_STORES },
  );

  return (
    <figure className="m-0">
      <figcaption className="flex items-center gap-4 px-3 pt-2 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4" style={{ background: ORIGINAL_COLOR }} aria-hidden />
          Original
        </span>
        {hasProcessed && (
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4" style={{ background: CHART.spectrum }} aria-hidden />
            Processed
          </span>
        )}
      </figcaption>
      <div
        role="img"
        aria-label="Spectra of the original and processed signals"
        data-testid="processed-spectrum"
        className="relative h-64 touch-none"
        {...hoverProps}
      >
        <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
        <Tooltip element={tooltip} />
      </div>
    </figure>
  );
}
