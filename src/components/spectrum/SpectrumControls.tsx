"use client";

import { LabeledSelect, Segmented } from "@/components/shared/controls";
import { useStore } from "@/stores/create-store";
import { settingsStore, type SpectrumSource } from "@/stores/settings-store";

const SOURCES = [
  { value: "scope", label: "Averaged scope" },
  { value: "playhead", label: "At playhead" },
] as const;

const SMOOTHING = [
  { value: 0, label: "None" },
  { value: 0.6, label: "Light" },
  { value: 0.85, label: "Heavy" },
];

export function SpectrumControls() {
  const source = useStore(settingsStore, (s) => s.spectrumSource);
  const smoothing = useStore(settingsStore, (s) => s.liveSmoothing);
  return (
    <>
      <Segmented<SpectrumSource>
        label="Spectrum source"
        value={source}
        options={SOURCES}
        onChange={(value) => settingsStore.set({ spectrumSource: value })}
      />
      {source === "playhead" && (
        <LabeledSelect
          label="Averaging"
          value={smoothing}
          options={SMOOTHING}
          onChange={(value) => settingsStore.set({ liveSmoothing: value })}
        />
      )}
    </>
  );
}
