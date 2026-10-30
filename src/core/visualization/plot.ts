import type { FrequencyRange, TimeRange } from "@/stores/selection-store";
import { formatTime } from "@/utils/formatting";
import { linearTicks } from "./scales";

/** Canvas colours; these mirror the CSS tokens, which a canvas cannot read directly. */
export const CHART = {
  background: "#101621",
  grid: "#1f2a3b",
  axis: "#6c7a8e",
  label: "#9aa8bb",
  zero: "#3a4a61",
  channels: ["#12a5bd", "#9772ec"],
  spectrum: "#22d3ee",
  playhead: "#f4f7fb",
  selection: "rgba(34, 211, 238, 0.14)",
  selectionEdge: "rgba(34, 211, 238, 0.75)",
  dim: "rgba(5, 8, 14, 0.5)",
  silence: "#9aa8bb",
  clipping: "#fbbf24",
  onset: "rgba(251, 191, 36, 0.7)",
} as const;

export const CHART_FONT = "11px var(--font-geist-sans), system-ui, sans-serif";

export interface PlotArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Fixed gutters, so waveform and spectrogram time axes line up exactly. */
export function timePlotArea(width: number, height: number): PlotArea {
  return { left: 52, top: 6, width: Math.max(1, width - 66), height: Math.max(1, height - 28) };
}

export const timeToX = (t: number, view: TimeRange, area: PlotArea) =>
  area.left + ((t - view.start) / (view.end - view.start)) * area.width;

export const xToTime = (x: number, view: TimeRange, area: PlotArea) =>
  view.start + ((x - area.left) / area.width) * (view.end - view.start);

export function drawTimeAxis(ctx: CanvasRenderingContext2D, area: PlotArea, view: TimeRange): void {
  const span = view.end - view.start;
  const ticks = linearTicks(view.start, view.end, Math.max(2, Math.floor(area.width / 110)));
  const y = area.top + area.height;
  ctx.font = CHART_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const t of ticks) {
    const x = timeToX(t, view, area);
    ctx.fillStyle = CHART.axis;
    ctx.fillRect(Math.round(x), y, 1, 4);
    ctx.fillStyle = CHART.label;
    // The last label would otherwise run past the right edge of the chart.
    const nearEnd = area.left + area.width - x < 24;
    ctx.textAlign = nearEnd ? "right" : "center";
    ctx.fillText(formatTime(t, span), nearEnd ? area.left + area.width + 12 : x, y + 6);
  }
}

/** Selection shading and the playhead, shared by every time-based view. */
export function drawTimeOverlay(
  ctx: CanvasRenderingContext2D,
  area: PlotArea,
  view: TimeRange,
  time: TimeRange | null,
  position: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(area.left, 0, area.width, area.top + area.height);
  ctx.clip();
  if (time) {
    const x0 = timeToX(time.start, view, area);
    const x1 = timeToX(time.end, view, area);
    ctx.fillStyle = CHART.selection;
    ctx.fillRect(x0, area.top, x1 - x0, area.height);
    ctx.fillStyle = CHART.selectionEdge;
    ctx.fillRect(x0, area.top, 1, area.height);
    ctx.fillRect(x1 - 1, area.top, 1, area.height);
  }
  const px = timeToX(position, view, area);
  ctx.fillStyle = CHART.playhead;
  ctx.fillRect(px - 0.5, area.top, 1.5, area.height);
  ctx.restore();
}

/** Dims everything outside a frequency band, given a frequency-to-y mapping. */
export function drawFrequencyBandY(
  ctx: CanvasRenderingContext2D,
  area: PlotArea,
  band: FrequencyRange,
  toY: (hz: number) => number,
): void {
  const top = Math.max(area.top, toY(band.max));
  const bottom = Math.min(area.top + area.height, toY(band.min));
  ctx.fillStyle = CHART.dim;
  ctx.fillRect(area.left, area.top, area.width, Math.max(0, top - area.top));
  ctx.fillRect(area.left, bottom, area.width, Math.max(0, area.top + area.height - bottom));
  ctx.fillStyle = CHART.selectionEdge;
  ctx.fillRect(area.left, top, area.width, 1);
  ctx.fillRect(area.left, bottom, area.width, 1);
}
