"use client";

import { Explained, LabeledSelect } from "@/components/shared/controls";
import type { MetricId } from "@/core/analysis/metric-docs";
import { useSpectralDescriptors } from "@/hooks/use-spectral-descriptors";
import { audioStore } from "@/stores/audio-store";
import { useStore } from "@/stores/create-store";
import { channelSelectionLabel } from "@/types/analysis";
import { selectionStore } from "@/stores/selection-store";
import { settingsStore } from "@/stores/settings-store";
import { formatDb, formatHz } from "@/utils/formatting";

const ROLLOFF_OPTIONS = [50, 75, 85, 90, 95, 99].map((value) => ({
  value,
  label: `${value}%`,
}));

function Descriptor({
  metric,
  label,
  value,
  detail,
}: {
  metric: MetricId;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div>
      <Explained metric={metric}>
        <h3 className="text-xs font-normal text-muted">{label}</h3>
      </Explained>
      <p className="text-lg tabular-nums">{value}</p>
      {detail && <p className="text-[11px] tabular-nums text-faint">{detail}</p>}
    </div>
  );
}

export function DescriptorPanel() {
  const descriptors = useSpectralDescriptors();
  const spectrum = useStore(audioStore, (s) => s.spectrum);
  const percent = useStore(settingsStore, (s) => s.rolloffPercent);
  const channel = useStore(settingsStore, (s) => s.channel);
  const labels = useStore(audioStore, (s) => s.recording?.decoded.channelLabels);
  const time = useStore(selectionStore, (s) => s.time);
  const frequency = useStore(selectionStore, (s) => s.frequency);
  const channelLabel = channelSelectionLabel(channel, labels);

  const empty = !descriptors || descriptors.centroidHz === null;
  return (
    <section className="border-b border-line p-3" data-testid="descriptors">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Spectral descriptors</h2>
        <LabeledSelect
          label="Rolloff energy"
          value={percent}
          options={ROLLOFF_OPTIONS}
          onChange={(value) => settingsStore.set({ rolloffPercent: value })}
        />
      </div>
      {!descriptors ? (
        <p className="text-sm text-muted">Computing…</p>
      ) : empty ? (
        <p className="text-sm text-muted">
          There is no spectral energy here, so these measures are undefined.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <Descriptor metric="centroid" label="Centroid" value={formatHz(descriptors.centroidHz!)} />
          <Descriptor
            metric="rolloff"
            label={`Rolloff (${percent}%)`}
            value={formatHz(descriptors.rolloffHz!)}
          />
          <Descriptor
            metric="flatness"
            label="Flatness"
            value={descriptors.flatness!.toFixed(4)}
            detail={formatDb(descriptors.flatnessDb, "dB")}
          />
        </div>
      )}
      {spectrum && (
        <p className="mt-2 text-[11px] text-faint">
          {channelLabel}, {time ? "selection" : "whole recording"}
          {frequency && `, ${formatHz(frequency.min)} to ${formatHz(frequency.max)}`}: FFT{" "}
          {spectrum.fftSize}, {spectrum.windowFunction} window, {spectrum.framesAveraged} frame
          {spectrum.framesAveraged === 1 ? "" : "s"} averaged. Not affected by the Min and Max Hz view.
        </p>
      )}
    </section>
  );
}
