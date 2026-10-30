"use client";

import { TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { Explained } from "@/components/shared/controls";
import { useSpectralPeaks } from "@/hooks/use-spectral-peaks";
import { RegionSection } from "./RegionSection";
import { audioStore } from "@/stores/audio-store";
import { useStore } from "@/stores/create-store";
import { clearSelection, selectionStore } from "@/stores/selection-store";
import { settingsStore } from "@/stores/settings-store";
import { channelSelectionLabel, type AmplitudeMeasurement } from "@/types/analysis";
import {
  formatAmplitude,
  formatBytes,
  formatCount,
  formatDb,
  formatHz,
  formatTimePrecise,
} from "@/utils/formatting";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line px-3 py-3">
      <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-faint">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-0.5 text-xs">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right tabular-nums">{value}</dd>
    </div>
  );
}

function ScopeSection() {
  const time = useStore(selectionStore, (s) => s.time);
  const frequency = useStore(selectionStore, (s) => s.frequency);
  const duration = useStore(audioStore, (s) => s.recording?.decoded.duration ?? 0);
  return (
    <Section title="Scope">
      <dl data-testid="scope">
        <Row
          label="Time"
          value={
            time
              ? `${formatTimePrecise(time.start)} – ${formatTimePrecise(time.end)}`
              : `Whole recording`
          }
        />
        <Row label="Length" value={`${(time ? time.end - time.start : duration).toFixed(3)} s`} />
        <Row
          label="Frequency"
          value={frequency ? `${formatHz(frequency.min)} – ${formatHz(frequency.max)}` : "All"}
        />
      </dl>
      {(time || frequency) && (
        <button
          type="button"
          onClick={clearSelection}
          className="mt-1.5 flex items-center gap-1 text-xs text-accent hover:underline"
        >
          <X className="size-3" aria-hidden />
          Clear selection (Esc)
        </button>
      )}
    </Section>
  );
}

function ChannelLevels({ label, m, showLabel }: { label: string; m: AmplitudeMeasurement; showLabel: boolean }) {
  return (
    <div className="mb-2 last:mb-0">
      {showLabel && <p className="mb-0.5 text-xs font-medium">{label}</p>}
      <div className="space-y-0.5 text-xs">
        <Explained metric="peak">
          <span className="text-muted">Peak</span>
          <span className="ml-auto tabular-nums" data-testid={`peak-${label}`}>
            {formatDb(m.peakDbfs)}
          </span>
        </Explained>
        <Explained metric="rms">
          <span className="text-muted">RMS</span>
          <span className="ml-auto tabular-nums" data-testid={`rms-${label}`}>
            {formatDb(m.rmsDbfs)}
          </span>
        </Explained>
        <Explained metric="crest">
          <span className="text-muted">Crest factor</span>
          <span className="ml-auto tabular-nums">
            {m.crestFactorDb === null ? "Undefined" : formatDb(m.crestFactorDb, "dB")}
          </span>
        </Explained>
      </div>
      <details className="mt-1">
        <summary className="text-[11px] text-faint hover:text-muted">More measurements</summary>
        <div className="mt-1 space-y-0.5 text-xs">
          <Explained metric="extremes">
            <span className="text-muted">Max / min</span>
            <span className="ml-auto tabular-nums">
              {formatAmplitude(m.maxPositive)} / {formatAmplitude(m.maxNegative)}
            </span>
          </Explained>
          <Explained metric="mean">
            <span className="text-muted">Mean</span>
            <span className="ml-auto tabular-nums">{m.mean.toExponential(2).replace("-", "−")}</span>
          </Explained>
          <Explained metric="clipping">
            <span className="text-muted">At full scale</span>
            <span className="ml-auto tabular-nums">
              {formatCount(m.clippedSamples)}
              {m.sampleCount > 0 && ` (${((100 * m.clippedSamples) / m.sampleCount).toFixed(3)}%)`}
            </span>
          </Explained>
        </div>
      </details>
    </div>
  );
}

function LevelSection() {
  const amplitude = useStore(audioStore, (s) => s.amplitude);
  return (
    <Section title="Level">
      {amplitude ? (
        amplitude.map(({ label, measurement }) => (
          <ChannelLevels
            key={label}
            label={label}
            m={measurement}
            showLabel={amplitude.length > 1}
          />
        ))
      ) : (
        <p className="text-xs text-muted">Measuring…</p>
      )}
    </Section>
  );
}

function PeaksSection() {
  const peaks = useSpectralPeaks();
  const spectrum = useStore(audioStore, (s) => s.spectrum);
  const scope = useStore(selectionStore, (s) => (s.time ? "selection" : "whole recording"));
  const channel = useStore(settingsStore, (s) => s.channel);
  const labels = useStore(audioStore, (s) => s.recording?.decoded.channelLabels);
  const channelLabel = channelSelectionLabel(channel, labels);
  return (
    <Section title="Frequency peaks">
      <Explained metric="peaks">
        <span className="text-xs text-muted">
          {channelLabel}, {scope}
        </span>
      </Explained>
      {!spectrum ? (
        <p className="mt-1 text-xs text-muted">Computing…</p>
      ) : peaks.length === 0 ? (
        <p className="mt-1 text-xs text-muted">
          No prominent peaks here. Noise-like, silent or dense material may not have any.
        </p>
      ) : (
        <table className="mt-1 w-full text-xs tabular-nums" data-testid="peaks">
          <thead>
            <tr className="text-left text-[11px] text-faint">
              <th className="font-normal">Frequency</th>
              <th className="text-right font-normal">Level</th>
              <th className="text-right font-normal">Prom.</th>
              <th className="pl-2 text-right font-normal">Band</th>
            </tr>
          </thead>
          <tbody>
            {peaks.map((peak) => (
              <tr key={peak.frequencyHz}>
                <td className="py-0.5">{formatHz(peak.frequencyHz)}</td>
                <td className="text-right">{peak.levelDb.toFixed(1).replace("-", "−")}</td>
                <td className="text-right">{peak.prominenceDb.toFixed(1)}</td>
                <td className="truncate pl-2 text-right text-muted">{peak.band}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {spectrum && (
        <p className="mt-1.5 text-[11px] text-faint">
          {spectrum.framesAveraged} frame{spectrum.framesAveraged === 1 ? "" : "s"} averaged, FFT{" "}
          {spectrum.fftSize}
          {spectrum.zeroPadded && ", zero-padded (selection shorter than the FFT)"}
        </p>
      )}
    </Section>
  );
}

function FileSection() {
  const recording = useStore(audioStore, (s) => s.recording);
  if (!recording) return null;
  const { original, decoded, warnings } = recording;
  return (
    <>
      {warnings.length > 0 && (
        <section className="space-y-1 border-b border-line bg-amber/5 px-3 py-2.5">
          {warnings.map((warning) => (
            <p key={warning} className="flex gap-1.5 text-xs">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber" aria-hidden />
              {warning}
            </p>
          ))}
        </section>
      )}
      <Section title="Original file">
        <dl data-testid="original-metadata">
          <Row label="Format" value={original.formatLabel} />
          {original.encoding && <Row label="Encoding" value={original.encoding} />}
          <Row label="Size" value={formatBytes(original.sizeBytes)} />
          <Row label="Sample rate" value={original.sampleRate ? `${original.sampleRate} Hz` : "Not read"} />
          <Row label="Channels" value={original.channelCount ?? "Not read"} />
          <Row label="Bit depth" value={original.bitDepth ? `${original.bitDepth}-bit` : "Not stored"} />
        </dl>
      </Section>
      <Section title="Decoded audio">
        <dl data-testid="decoded-metadata">
          <Row label="Sample rate" value={`${decoded.sampleRate} Hz`} />
          <Row label="Channels" value={decoded.channelLabels.join(", ")} />
          <Row label="Samples" value={formatCount(decoded.frameCount)} />
          <Row label="Duration" value={`${decoded.duration.toFixed(3)} s`} />
          <Row label="Format" value="32-bit float (browser)" />
        </dl>
        <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
          Browsers always decode to 32-bit float. This says nothing about the original
          file&apos;s precision.
        </p>
      </Section>
    </>
  );
}

export function Inspector() {
  return (
    <div className="h-full overflow-y-auto" data-testid="inspector">
      <ScopeSection />
      <RegionSection />
      <LevelSection />
      <PeaksSection />
      <FileSection />
    </div>
  );
}
