"use client";

import { useRef } from "react";
import { CHART, CHART_FONT } from "@/core/visualization/plot";
import { useCanvasRenderer } from "@/hooks/use-canvas-renderer";

const LEFT = 44;
const RIGHT = 10;
const TOP = 8;
const BOTTOM = 24;

/** Bars on a logarithmic count axis, so rare values stay visible next to common ones. */
export function HistogramChart({
  counts,
  color,
  xTicks,
  xLabel,
  describeBin,
  label,
}: {
  counts: Uint32Array;
  color: string;
  /** Tick positions as bin fractions 0..1, with their text. */
  xTicks: ReadonlyArray<readonly [number, string]>;
  xLabel: string;
  describeBin: (index: number, count: number) => string;
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);

  useCanvasRenderer(canvas, (ctx, width, height) => {
    ctx.fillStyle = CHART.background;
    ctx.fillRect(0, 0, width, height);
    const plotWidth = Math.max(1, width - LEFT - RIGHT);
    const plotHeight = Math.max(1, height - TOP - BOTTOM);
    const max = Math.max(1, ...counts);
    const decades = Math.max(1, Math.ceil(Math.log10(max)));
    const toY = (count: number) => TOP + plotHeight * (1 - Math.log10(count) / decades);

    ctx.font = CHART_FONT;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let d = 0; d <= decades; d++) {
      const y = Math.round(toY(10 ** d));
      ctx.fillStyle = CHART.grid;
      ctx.fillRect(LEFT, y, plotWidth, 1);
      ctx.fillStyle = CHART.label;
      ctx.fillText(d < 3 ? String(10 ** d) : `10${"⁰¹²³⁴⁵⁶⁷⁸⁹"[d]}`, LEFT - 6, y);
    }

    const barWidth = plotWidth / counts.length;
    const gap = barWidth > 3 ? 1 : 0;
    ctx.fillStyle = color;
    counts.forEach((count, index) => {
      if (count === 0) return;
      const y = toY(count);
      // A count of one sits on the baseline, so give it a visible minimum height.
      const barHeight = Math.max(2, TOP + plotHeight - y);
      ctx.fillRect(LEFT + index * barWidth, TOP + plotHeight - barHeight, barWidth - gap, barHeight);
    });

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = CHART.label;
    for (const [fraction, text] of xTicks) {
      ctx.fillText(text, LEFT + fraction * plotWidth, TOP + plotHeight + 6);
    }
  });

  return (
    <figure className="m-0">
      <figcaption className="px-3 pt-2 text-xs text-muted">{xLabel}</figcaption>
      <div
        ref={container}
        role="img"
        aria-label={label}
        className="relative h-40 touch-none"
        onPointerLeave={() => {
          if (tooltip.current) tooltip.current.hidden = true;
        }}
        onPointerMove={(event) => {
          const element = tooltip.current;
          if (!element) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const fraction = (x - LEFT) / (rect.width - LEFT - RIGHT);
          if (fraction < 0 || fraction >= 1) {
            element.hidden = true;
            return;
          }
          const index = Math.floor(fraction * counts.length);
          element.hidden = false;
          element.textContent = describeBin(index, counts[index]);
          const left = x > rect.width - 200 ? x - 190 : x + 12;
          element.style.transform = `translate(${left}px, 6px)`;
        }}
      >
        <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
        <div
          ref={tooltip}
          hidden
          className="pointer-events-none absolute left-0 top-0 whitespace-pre rounded border border-line bg-deep/95 px-1.5 py-0.5 text-[11px] tabular-nums"
        />
      </div>
    </figure>
  );
}
