"use client";

import { useMemo } from "react";
import { DEFAULT_PEAK_OPTIONS, detectPeaks } from "@/core/dsp/peaks";
import { audioStore } from "@/stores/audio-store";
import { useStore } from "@/stores/create-store";
import { selectionStore } from "@/stores/selection-store";
import { settingsStore } from "@/stores/settings-store";
import type { SpectralPeak } from "@/types/analysis";

/** Peaks of the current scope spectrum, honouring the shared frequency selection. */
export function useSpectralPeaks(): SpectralPeak[] {
  const spectrum = useStore(audioStore, (s) => s.spectrum);
  const prominence = useStore(settingsStore, (s) => s.peakProminenceDb);
  const frequency = useStore(selectionStore, (s) => s.frequency);
  return useMemo(() => {
    if (!spectrum) return [];
    return detectPeaks(spectrum.levelDb, spectrum.sampleRate, spectrum.fftSize, {
      ...DEFAULT_PEAK_OPTIONS,
      minProminenceDb: prominence,
      minHz: frequency?.min,
      maxHz: frequency?.max,
    });
  }, [spectrum, prominence, frequency]);
}
