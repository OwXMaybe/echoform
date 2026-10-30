"use client";

import { RotateCcw, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { LabeledSelect, Segmented } from "@/components/shared/controls";
import { COLOR_MAPS, type ColorMapName } from "@/core/visualization/color-maps";
import { useStore } from "@/stores/create-store";
import {
  resetSettings,
  setRememberSettings,
  settingsStore,
  type SettingsState,
} from "@/stores/settings-store";
import { FFT_SIZES, WINDOW_FUNCTIONS } from "@/types/analysis";

const capitalise = (value: string) => value[0].toUpperCase() + value.slice(1);
const FFT_OPTIONS = FFT_SIZES.map((value) => ({ value, label: String(value) }));
const WINDOW_OPTIONS = WINDOW_FUNCTIONS.map((value) => ({ value, label: capitalise(value) }));
const HOP_OPTIONS = ([2, 4, 8, 16] as const).map((value) => ({ value, label: `1/${value} FFT` }));
const RANGE_OPTIONS = [60, 72, 96, 120, 144].map((value) => ({ value, label: `${value} dB` }));
const MAP_OPTIONS = (Object.keys(COLOR_MAPS) as ColorMapName[]).map((value) => ({
  value,
  label: capitalise(value),
}));
const SCALE_OPTIONS = [
  { value: "log", label: "Log" },
  { value: "linear", label: "Linear" },
] as const;

const SHORTCUTS = [
  ["Space", "Play or pause"],
  ["S", "Stop"],
  ["L", "Loop the selection"],
  ["M", "Mute"],
  ["[  ]", "Set selection start or end at the playhead"],
  ["Esc", "Clear the selection"],
  ["← →", "Seek one second"],
  ["Home", "Go to the start"],
  ["+  −", "Zoom in or out"],
  ["0", "Show the whole recording"],
] as const;

const update = (patch: Partial<SettingsState>) => settingsStore.set(patch);

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line py-4">
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

function NumberField({
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs text-muted">
      {label}
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (event.target.value !== "" && next >= min && next <= max) onChange(next);
          }}
          className="w-20 rounded border border-line bg-raised px-1.5 py-1 text-right tabular-nums text-ink"
        />
        <span className="w-8">{unit}</span>
      </span>
    </label>
  );
}

export default function SettingsPage() {
  const s = useStore(settingsStore, (state) => state);
  return (
    <div className="mx-auto max-w-3xl px-4 pb-8 md:px-6">
      <header className="flex items-center justify-between gap-3 pt-5">
        <h1 className="text-lg font-semibold">Settings</h1>
        <button
          type="button"
          onClick={resetSettings}
          className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-raised"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Restore defaults
        </button>
      </header>

      <Group title="Visualization">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <LabeledSelect
            label="Colour map"
            value={s.colorMap}
            options={MAP_OPTIONS}
            onChange={(colorMap) => update({ colorMap })}
          />
          <LabeledSelect
            label="Dynamic range"
            value={s.dynamicRangeDb}
            options={RANGE_OPTIONS}
            onChange={(dynamicRangeDb) => update({ dynamicRangeDb })}
          />
          <span className="flex items-center gap-1.5 text-xs text-muted">
            Frequency scale
            <Segmented
              label="Frequency scale"
              value={s.frequencyScale}
              options={SCALE_OPTIONS}
              onChange={(frequencyScale) => update({ frequencyScale })}
            />
          </span>
        </div>
      </Group>

      <Group title="Processing">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <LabeledSelect
            label="FFT size"
            value={s.fftSize}
            options={FFT_OPTIONS}
            onChange={(fftSize) => update({ fftSize })}
          />
          <LabeledSelect
            label="Window"
            value={s.windowFunction}
            options={WINDOW_OPTIONS}
            onChange={(windowFunction) => update({ windowFunction })}
          />
          <LabeledSelect
            label="Spectrogram hop"
            value={s.hopDivisor}
            options={HOP_OPTIONS}
            onChange={(hopDivisor) => update({ hopDivisor })}
          />
        </div>
        <div className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
          <NumberField
            label="Spectral rolloff"
            unit="%"
            value={s.rolloffPercent}
            min={50}
            max={99}
            step={1}
            onChange={(rolloffPercent) => update({ rolloffPercent })}
          />
          <NumberField
            label="Peak prominence"
            unit="dB"
            value={s.peakProminenceDb}
            min={3}
            max={40}
            step={1}
            onChange={(peakProminenceDb) => update({ peakProminenceDb })}
          />
          <NumberField
            label="Silence threshold"
            unit="dBFS"
            value={s.silenceThresholdDb}
            min={-120}
            max={-20}
            step={1}
            onChange={(silenceThresholdDb) => update({ silenceThresholdDb })}
          />
          <NumberField
            label="Shortest silence"
            unit="s"
            value={s.silenceMinSeconds}
            min={0.05}
            max={10}
            step={0.05}
            onChange={(silenceMinSeconds) => update({ silenceMinSeconds })}
          />
          <NumberField
            label="DC offset warning"
            unit=""
            value={s.dcWarningThreshold}
            min={0.0001}
            max={0.5}
            step={0.001}
            onChange={(dcWarningThreshold) => update({ dcWarningThreshold })}
          />
          <NumberField
            label="Live spectrum smoothing"
            unit=""
            value={s.liveSmoothing}
            min={0}
            max={0.95}
            step={0.05}
            onChange={(liveSmoothing) => update({ liveSmoothing })}
          />
        </div>
      </Group>

      <Group title="Audio">
        <p className="text-xs leading-relaxed text-muted">
          Playback uses your device&apos;s default output through the browser, which may resample
          it. Measurements always use the decoded recording, never the output. Volume and speed are
          on the player and apply to the current session only.
        </p>
      </Group>

      <Group title="Privacy">
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
          Audio is decoded and analysed in this browser tab. ECHOFORM has no account, no uploads and
          no analytics, and recordings are never saved: closing the tab or the recording releases
          them. Exported reports stay on your device unless you share them.
        </p>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={s.rememberSettings}
            onChange={(event) => setRememberSettings(event.target.checked)}
          />
          <span>
            Remember these settings on this device
            <span className="block text-xs text-muted">
              Off by default. When on, the options above are kept in this browser&apos;s local
              storage, and nothing about your recordings is. Turning it off deletes them.
            </span>
          </span>
        </label>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={s.reportIncludeFileNames}
            onChange={(event) => update({ reportIncludeFileNames: event.target.checked })}
          />
          <span>
            Include file names in reports
            <span className="block text-xs text-muted">
              File names can reveal private details. Turn this off before sharing a report.
            </span>
          </span>
        </label>
      </Group>

      <section className="pt-4">
        <h2 className="mb-2 text-sm font-medium">Keyboard shortcuts</h2>
        <dl className="grid gap-x-8 gap-y-1 text-xs sm:grid-cols-2">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={action} className="flex justify-between gap-3">
              <dd className="m-0 text-muted">{action}</dd>
              <dt className="whitespace-pre font-mono text-ink">{keys}</dt>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
