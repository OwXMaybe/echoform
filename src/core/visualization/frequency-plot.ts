import { formatAxisHz } from "@/utils/formatting";
import { CHART, CHART_FONT, type PlotArea } from "./plot";
import {
  fractionToFrequency,
  frequencyTicks,
  frequencyToFraction,
  linearTicks,
  type FrequencyAxis,
} from "./scales";

/** Fixed gutters shared by every chart with a frequency x axis. */
export function frequencyPlotArea(width: number, height: number): PlotArea {
  return { left: 52, top: 10, width: Math.max(1, width - 66), height: Math.max(1, height - 34) };
}

export const frequencyToX = (hz: number, axis: FrequencyAxis, area: PlotArea) =>
  area.left + frequencyToFraction(hz, axis) * area.width;

/** Gridlines and labels for a frequency x axis and a linear y axis. */
export function drawFrequencyAxes(
  ctx: CanvasRenderingContext2D,
  area: PlotArea,
  axis: FrequencyAxis,
  yMin: number,
  yMax: number,
  yLabel: string,
  yTicks = 6,
): (value: number) => number {
  const toY = (value: number) => area.top + ((yMax - value) / (yMax - yMin)) * area.height;
  ctx.font = CHART_FONT;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  for (const value of linearTicks(yMin, yMax, yTicks)) {
    const y = Math.round(toY(value));
    ctx.fillStyle = value === 0 ? CHART.zero : CHART.grid;
    ctx.fillRect(area.left, y, area.width, 1);
    ctx.fillStyle = CHART.label;
    ctx.fillText(`${value}`.replace("-", "−"), area.left - 6, y);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  let lastX = -Infinity;
  for (const hz of frequencyTicks(axis)) {
    const x = frequencyToX(hz, axis, area);
    ctx.fillStyle = CHART.grid;
    ctx.fillRect(Math.round(x), area.top, 1, area.height);
    if (x - lastX < 34) continue;
    lastX = x;
    ctx.fillStyle = CHART.label;
    ctx.fillText(formatAxisHz(hz), x, area.top + area.height + 6);
  }
  ctx.save();
  ctx.translate(11, area.top + area.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "middle";
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
  return toY;
}

/** Traces a per-bin spectrum: the strongest bin where bins are dense, interpolation where sparse. */
export function traceBinCurve(
  ctx: CanvasRenderingContext2D,
  area: PlotArea,
  axis: FrequencyAxis,
  level: Float32Array,
  binHz: number,
  toY: (db: number) => number,
  floorDb: number,
): void {
  ctx.beginPath();
  for (let px = 0; px <= area.width; px++) {
    const f0 = fractionToFrequency(px / area.width, axis);
    const f1 = fractionToFrequency((px + 1) / area.width, axis);
    const b0 = Math.min(level.length - 1, Math.round(f0 / binHz));
    const b1 = Math.min(level.length - 1, Math.max(b0, Math.round(f1 / binHz) - 1));
    let best = floorDb;
    if (b1 > b0) {
      for (let b = b0; b <= b1; b++) if (level[b] > best) best = level[b];
    } else {
      // Pixels finer than a bin: join the bin centres rather than drawing steps.
      const position = Math.min(level.length - 1.001, f0 / binHz);
      const bin = Math.floor(position);
      best = level[bin] + (position - bin) * (level[bin + 1] - level[bin]);
    }
    const y = Math.max(area.top, Math.min(area.top + area.height, toY(best)));
    if (px === 0) ctx.moveTo(area.left, y);
    else ctx.lineTo(area.left + px, y);
  }
}

/** Traces values given at known frequencies. */
export function tracePoints(
  ctx: CanvasRenderingContext2D,
  area: PlotArea,
  axis: FrequencyAxis,
  frequencies: Float32Array,
  values: Float32Array,
  toY: (value: number) => number,
): void {
  ctx.beginPath();
  for (let i = 0; i < frequencies.length; i++) {
    const x = frequencyToX(frequencies[i], axis, area);
    const y = Math.max(area.top, Math.min(area.top + area.height, toY(values[i])));
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}
