import type { WindowFunction } from "@/types/analysis";

/** Periodic (DFT-even) windows, the correct form for spectral analysis. */
export function createWindow(type: WindowFunction, length: number): Float64Array {
  const w = new Float64Array(length);
  for (let n = 0; n < length; n++) {
    const x = (2 * Math.PI * n) / length;
    switch (type) {
      case "rectangular":
        w[n] = 1;
        break;
      case "hann":
        w[n] = 0.5 - 0.5 * Math.cos(x);
        break;
      case "hamming":
        w[n] = 0.54 - 0.46 * Math.cos(x);
        break;
      case "blackman":
        w[n] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
        break;
    }
  }
  return w;
}

export interface WindowProperties {
  /** Sum of the window divided by its length; corrects amplitude for tones. */
  coherentGain: number;
  /** Equivalent noise bandwidth, in bins. */
  enbwBins: number;
}

export function windowProperties(window: Float64Array): WindowProperties {
  let sum = 0;
  let sumSquared = 0;
  for (let i = 0; i < window.length; i++) {
    sum += window[i];
    sumSquared += window[i] * window[i];
  }
  return {
    coherentGain: sum / window.length,
    enbwBins: (window.length * sumSquared) / (sum * sum),
  };
}
