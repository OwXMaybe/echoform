import { spectrogramColumnAt } from "@/core/dsp/stft";
import { createWindow, windowProperties } from "@/core/dsp/windows";
import type { RegionMeasurement, SpectrogramResult } from "@/types/analysis";

export interface RegionBounds {
  startSeconds: number;
  endSeconds: number;
  minHz: number;
  maxHz: number;
}

/**
 * Measures a time-frequency box. Power is summed across the band and corrected for the window's
 * noise bandwidth, which gives RMS-equivalent level: a sine alone in the band reads the same as
 * its time-domain RMS. The result inherits the spectrogram's time and frequency resolution.
 */
export function measureRegion(g: SpectrogramResult, bounds: RegionBounds): RegionMeasurement {
  const c0 = spectrogramColumnAt(g, bounds.startSeconds);
  const c1 = spectrogramColumnAt(g, bounds.endSeconds);
  const b0 = Math.max(0, Math.min(g.bins - 1, Math.round(bounds.minHz / g.frequencyResolution)));
  const b1 = Math.max(b0, Math.min(g.bins - 1, Math.round(bounds.maxHz / g.frequencyResolution)));
  const { enbwBins } = windowProperties(createWindow(g.windowFunction, g.fftSize));

  let peakDb = -Infinity;
  let peakColumn = c0;
  let peakBin = b0;
  let powerSum = 0;
  for (let c = c0; c <= c1; c++) {
    const offset = c * g.bins;
    for (let b = b0; b <= b1; b++) {
      const db = g.data[offset + b];
      powerSum += Math.pow(10, db / 10);
      if (db > peakDb) {
        peakDb = db;
        peakColumn = c;
        peakBin = b;
      }
    }
  }
  const columns = c1 - c0 + 1;
  // Bins read A^2 for a sine of amplitude A, whose mean power is A^2 / 2.
  const meanPower = powerSum / columns / enbwBins / 2;
  return {
    bandLevelDb: meanPower > 1e-20 ? 10 * Math.log10(meanPower) : null,
    peakDb: peakDb > -200 ? peakDb : null,
    peakSeconds: g.startSeconds + (peakColumn * g.hopSize * g.framesPerColumn) / g.sampleRate,
    peakHz: peakBin * g.frequencyResolution,
    columns,
    bins: b1 - b0 + 1,
  };
}
