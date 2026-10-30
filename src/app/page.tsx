"use client";

import { ArrowRight, Check, Minus } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { DropZone } from "@/components/shared/DropZone";
import { probeFormatSupport, type FormatSupport } from "@/core/audio/decoder";
import { audioStore } from "@/stores/audio-store";
import { useStore } from "@/stores/create-store";
import { formatBytes } from "@/utils/formatting";

const AVAILABLE = [
  ["Waveform", "Min/max rendering with zoom, pan and sample-level detail."],
  ["Level measurements", "Peak, RMS, crest factor, mean and full-scale counts."],
  ["FFT spectrum", "Calibrated spectra with four windows and seven FFT sizes."],
  ["Peak detection", "Prominence-based peaks with adjustable sensitivity."],
  ["Spectrogram", "Region measurements, band zoom, and detail recovered as you zoom in."],
  ["Synced playback", "Selections drive the player, charts and measurements together."],
  ["Silence detection", "Configurable regions, separating digital silence from quiet audio."],
  ["Clipping and DC offset", "Full-scale intervals by channel, with a configurable DC warning."],
  ["Level distribution", "Sample and short-term level histograms with a defined level range."],
  ["Spectral descriptors", "Centroid, rolloff and flatness, for a selection or a frequency band."],
  ["Stereo analysis", "Channel correlation, mid and side levels, a width index and a vectorscope."],
  ["Filter Laboratory", "Seven filter types with measured response, rendered without touching the original."],
  ["Comparison Lab", "Two recordings side by side, with explicit alignment and normalisation."],
  ["Onsets and tempo", "Spectral-flux events with adjustable sensitivity, and tempo with alternatives."],
  ["Pitch and harmonics", "A pitch track for periodic sources, with measured harmonics."],
  ["Noise analysis", "Background level with its method and limits, plus mains hum indicators."],
  ["Reports", "Everything measured, as JSON, CSV or a printable document with methods stated."],
] as const;

const subscribeNever = () => () => undefined;
const noSupportInfo = (): FormatSupport[] | null => null;

function FormatList() {
  const formats = useSyncExternalStore(subscribeNever, probeFormatSupport, noSupportInfo);
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium">Formats in this browser</h2>
      {formats && (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {formats.map(({ label, supported }) => (
            <li
              key={label}
              className={`flex items-center gap-1.5 ${supported ? "" : "text-faint"}`}
            >
              {supported ? (
                <Check className="size-3.5 text-accent" aria-hidden />
              ) : (
                <Minus className="size-3.5" aria-hidden />
              )}
              {label}
              {!supported && <span className="sr-only">not supported</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-faint">
        As reported by your browser. The final test is whether a file actually decodes.
      </p>
    </section>
  );
}

function CurrentRecording() {
  const recording = useStore(audioStore, (s) => s.recording);
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium">Current session</h2>
      {recording ? (
        <Link
          href="/workspace"
          className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 hover:bg-raised"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{recording.original.name}</span>
            <span className="text-xs tabular-nums text-muted">
              {recording.decoded.duration.toFixed(1)} s · {recording.decoded.sampleRate} Hz ·{" "}
              {formatBytes(recording.original.sizeBytes)}
            </span>
          </span>
          <ArrowRight className="size-4 shrink-0 text-muted" aria-hidden />
        </Link>
      ) : (
        <p className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-muted">
          No recording open. Recordings are not saved, so this list starts empty each session.
        </p>
      )}
    </section>
  );
}

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-accent">
          See the sound. Understand the frequency.
        </p>
        <h1 className="mt-2 max-w-2xl text-2xl font-semibold leading-tight md:text-3xl">
          Turn an audio file into something you can measure and explore.
        </h1>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <DropZone />
        <div className="space-y-6">
          <CurrentRecording />
          <FormatList />
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium">Available now</h2>
        <ul className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {AVAILABLE.map(([title, text]) => (
            <li key={title} className="bg-surface p-3">
              <p className="text-sm font-medium">{title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{text}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
