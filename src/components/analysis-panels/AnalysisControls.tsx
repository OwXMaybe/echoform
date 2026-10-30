"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Explained, LabeledSelect, Segmented } from "@/components/shared/controls";
import { COLOR_MAPS, type ColorMapName } from "@/core/visualization/color-maps";
import { audioStore } from "@/stores/audio-store";
import { useStore } from "@/stores/create-store";
import { settingsStore, type SettingsState } from "@/stores/settings-store";
import { FFT_SIZES, WINDOW_FUNCTIONS, type ChannelSelection } from "@/types/analysis";

const FFT_OPTIONS = FFT_SIZES.map((value) => ({ value, label: String(value) }));
const WINDOW_OPTIONS = WINDOW_FUNCTIONS.map((value) => ({
  value,
  label: value[0].toUpperCase() + value.slice(1),
}));
const HOP_OPTIONS = ([2, 4, 8, 16] as const).map((value) => ({ value, label: `1/${value} FFT` }));
const RANGE_OPTIONS = [60, 72, 96, 120, 144].map((value) => ({ value, label: `${value} dB` }));
const MAP_OPTIONS = (Object.keys(COLOR_MAPS) as ColorMapName[]).map((value) => ({
  value,
  label: value[0].toUpperCase() + value.slice(1),
}));
const SCALE_OPTIONS = [
  { value: "log", label: "Log" },
  { value: "linear", label: "Linear" },
] as const;

const update = (patch: Partial<SettingsState>) => settingsStore.set(patch);

function HzField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      {label}
      <input
        type="number"
        min={0}
        placeholder="Auto"
        value={value ?? ""}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          onChange(event.target.value === "" || !Number.isFinite(parsed) ? null : parsed);
        }}
        className="w-20 rounded border border-line bg-raised px-1.5 py-1 text-xs tabular-nums text-ink placeholder:text-faint"
      />
    </label>
  );
}

export function AnalysisControls() {
  const [advanced, setAdvanced] = useState(false);
  const fftSize = useStore(settingsStore, (s) => s.fftSize);
  const hopDivisor = useStore(settingsStore, (s) => s.hopDivisor);
  const windowFunction = useStore(settingsStore, (s) => s.windowFunction);
  const frequencyScale = useStore(settingsStore, (s) => s.frequencyScale);
  const channel = useStore(settingsStore, (s) => s.channel);
  const dynamicRangeDb = useStore(settingsStore, (s) => s.dynamicRangeDb);
  const colorMap = useStore(settingsStore, (s) => s.colorMap);
  const viewMinHz = useStore(settingsStore, (s) => s.viewMinHz);
  const viewMaxHz = useStore(settingsStore, (s) => s.viewMaxHz);
  const peakProminenceDb = useStore(settingsStore, (s) => s.peakProminenceDb);
  const labels = useStore(audioStore, (s) => s.recording?.decoded.channelLabels ?? null);
  const sampleRate = useStore(audioStore, (s) => s.recording?.decoded.sampleRate ?? 0);

  const channelOptions: { value: ChannelSelection; label: string }[] = (labels ?? []).map(
    (label, index) => ({ value: index, label }),
  );
  if (labels?.length === 2) {
    channelOptions.unshift({ value: "mix", label: "Mid (average)" });
    channelOptions.push({ value: "side", label: "Side (L − R) / 2" });
  } else if ((labels?.length ?? 0) > 1) {
    channelOptions.unshift({ value: "mix", label: "Mix (average)" });
  }

  const hop = fftSize / hopDivisor;

  return (
    <div className="border-b border-line bg-surface px-3 py-1.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <LabeledSelect
          label="FFT"
          value={fftSize}
          options={FFT_OPTIONS}
          onChange={(value) => update({ fftSize: value })}
        />
        <LabeledSelect
          label="Channel"
          value={channel}
          options={channelOptions}
          onChange={(value) => update({ channel: value })}
        />
        <Segmented
          label="Frequency scale"
          value={frequencyScale}
          options={SCALE_OPTIONS}
          onChange={(value) => update({ frequencyScale: value })}
        />
        <button
          type="button"
          aria-expanded={advanced}
          onClick={() => setAdvanced(!advanced)}
          className="flex items-center gap-1 text-xs text-muted hover:text-ink"
        >
          Advanced
          <ChevronDown
            className={`size-3.5 transition-transform ${advanced ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>
        <p className="ml-auto text-xs tabular-nums text-muted" data-testid="resolution">
          Δf {(sampleRate / fftSize).toFixed(2)} Hz · Δt {((1000 * hop) / sampleRate).toFixed(2)} ms
        </p>
      </div>
      {advanced && (
        <div className="mt-2 space-y-2 border-t border-line pt-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <LabeledSelect
              label="Window"
              value={windowFunction}
              options={WINDOW_OPTIONS}
              onChange={(value) => update({ windowFunction: value })}
            />
            <LabeledSelect
              label="Hop"
              value={hopDivisor}
              options={HOP_OPTIONS}
              onChange={(value) => update({ hopDivisor: value })}
            />
            <LabeledSelect
              label="Range"
              value={dynamicRangeDb}
              options={RANGE_OPTIONS}
              onChange={(value) => update({ dynamicRangeDb: value })}
            />
            <LabeledSelect
              label="Colour"
              value={colorMap}
              options={MAP_OPTIONS}
              onChange={(value) => update({ colorMap: value })}
            />
            <HzField
              label="Min Hz"
              value={viewMinHz}
              onChange={(value) => update({ viewMinHz: value })}
            />
            <HzField
              label="Max Hz"
              value={viewMaxHz}
              onChange={(value) => update({ viewMaxHz: value })}
            />
            <label className="flex items-center gap-1.5 text-xs text-muted">
              Peak prominence
              <input
                type="range"
                min={3}
                max={40}
                step={1}
                value={peakProminenceDb}
                onChange={(event) => update({ peakProminenceDb: Number(event.target.value) })}
                className="w-24"
              />
              <span className="w-10 tabular-nums text-ink">{peakProminenceDb} dB</span>
            </label>
          </div>
          <div className="grid gap-x-6 sm:grid-cols-2">
            <Explained metric="resolution">
              <span className="text-xs text-muted">FFT size trade-off</span>
            </Explained>
            <Explained metric="window">
              <span className="text-xs text-muted">Windows and spectral leakage</span>
            </Explained>
          </div>
        </div>
      )}
    </div>
  );
}
