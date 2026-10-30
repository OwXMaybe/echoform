"use client";

import { useMemo } from "react";
import { computeDescriptors } from "@/core/dsp/descriptors";
import { audioStore } from "@/stores/audio-store";
import { useStore } from "@/stores/create-store";
import { selectionStore } from "@/stores/selection-store";
import { settingsStore } from "@/stores/settings-store";
import type { SpectralDescriptors } from "@/types/analysis";

/** Descriptors of the current scope spectrum, honouring the shared frequency selection. */
export function useSpectralDescriptors(): SpectralDescriptors | null {
  const spectrum = useStore(audioStore, (s) => s.spectrum);
  const rolloffPercent = useStore(settingsStore, (s) => s.rolloffPercent);
  const frequency = useStore(selectionStore, (s) => s.frequency);
  return useMemo(() => {
    if (!spectrum) return null;
    return computeDescriptors(spectrum.levelDb, spectrum.sampleRate, spectrum.fftSize, {
      windowFunction: spectrum.windowFunction,
      rolloffPercent,
      minHz: frequency?.min,
      maxHz: frequency?.max,
    });
  }, [spectrum, rolloffPercent, frequency]);
}
