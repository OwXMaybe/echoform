"use client";

import { useEffect, useMemo } from "react";
import { Explained } from "@/components/shared/controls";
import { analyseHarmonics } from "@/core/dsp/harmonics";
import { MAX_APERIODICITY, frequencyToNote, summarisePitch } from "@/core/dsp/pitch";
import { audioStore } from "@/stores/audio-store";
import { useStore } from "@/stores/create-store";
import { insightsStore, setInsightsActive, setSensitivity } from "@/stores/insights-store";
import { seekTo } from "@/stores/playback-store";
import { selectionStore } from "@/stores/selection-store";
import { settingsStore } from "@/stores/settings-store";
import { channelSelectionLabel, type TempoCandidate } from "@/types/analysis";
import { formatDb, formatHz, formatTimePrecise } from "@/utils/formatting";
import { NoveltyChart, PitchChart } from "./InsightCharts";

const LISTED_ONSETS = 40;

const RELATION_LABEL: Record<TempoCandidate["relation"], string> = {
  best: "Best",
  double: "Double",
  half: "Half",
  "three-halves": "3:2",
  "two-thirds": "2:3",
  triple: "Triple",
  third: "Third",
  other: "Unrelated",
};

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-medium text-muted">{children}</h2>;
}

function Pending({ label }: { label: string }) {
  return <p className="mt-1 text-sm text-muted">{label}</p>;
}

function OnsetPanel() {
  const onsets = useStore(insightsStore, (s) => s.onsets);
  const sensitivity = useStore(insightsStore, (s) => s.sensitivity);
  const ready = useStore(insightsStore, (s) => s.novelty !== null);
  const progress = useStore(audioStore, (s) => s.progress.novelty);
  return (
    <section className="border-b border-line">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pt-2 text-xs text-muted">
        <Explained metric="onsets">
          <h2 className="font-medium">Onsets</h2>
        </Explained>
        <label className="flex items-center gap-1.5">
          Sensitivity
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={sensitivity}
            onChange={(event) => setSensitivity(Number(event.target.value))}
            className="w-28"
          />
          <span className="w-8 tabular-nums text-ink">{Math.round(sensitivity * 100)}%</span>
        </label>
        <span className="tabular-nums" data-testid="onset-count">
          {ready
            ? `${onsets.length} transient ${onsets.length === 1 ? "event" : "events"} in the recording`
            : `Measuring ${Math.round(progress * 100)}%…`}
        </span>
      </div>
      <p className="px-3 pb-1 text-xs text-faint">
        Bars show onset strength and the dashed line is the detection threshold. These are
        transients, not beats.
      </p>
      <NoveltyChart />
      {onsets.length > 0 && (
        <details className="px-3 py-2 text-xs text-muted">
          <summary className="cursor-pointer">Event list</summary>
          <ul className="mt-1 flex flex-wrap gap-1">
            {onsets.slice(0, LISTED_ONSETS).map(({ time }) => (
              <li key={time}>
                <button
                  type="button"
                  onClick={() => seekTo(time)}
                  className="rounded border border-line px-1.5 py-0.5 tabular-nums hover:bg-raised"
                >
                  {formatTimePrecise(time)}
                </button>
              </li>
            ))}
          </ul>
          {onsets.length > LISTED_ONSETS && (
            <p className="mt-1 text-faint">Showing the first {LISTED_ONSETS}.</p>
          )}
        </details>
      )}
    </section>
  );
}

function TempoPanel() {
  const tempo = useStore(insightsStore, (s) => s.tempo);
  return (
    <section className="border-b border-line px-3 py-3 md:border-r">
      <Explained metric="tempo">
        <Heading>Tempo</Heading>
      </Explained>
      {!tempo ? (
        <Pending label="Measuring…" />
      ) : (
        <>
          {tempo.bpm !== null ? (
            <p className="mt-1 text-2xl font-semibold tabular-nums" data-testid="tempo">
              {tempo.bpm.toFixed(1)} <span className="text-sm font-normal text-muted">BPM</span>
            </p>
          ) : (
            <p className="mt-1 text-sm" data-testid="tempo">
              No clear tempo
            </p>
          )}
          {tempo.reason && <p className="mt-0.5 text-xs text-muted">{tempo.reason}</p>}
          {tempo.candidates.length > 0 && (
            <>
              <p className="mt-1 text-xs tabular-nums text-muted">
                Confidence {tempo.confidence.toFixed(2)}
              </p>
              <table className="mt-1 w-full text-xs tabular-nums">
                <thead>
                  <tr className="text-left text-faint">
                    <th className="py-0.5 font-normal">Candidate</th>
                    <th className="py-0.5 font-normal">Relation</th>
                    <th className="py-0.5 text-right font-normal">Periodicity</th>
                  </tr>
                </thead>
                <tbody>
                  {tempo.candidates.map((candidate) => (
                    <tr key={candidate.bpm} className="border-t border-line">
                      <td className="py-0.5">{candidate.bpm.toFixed(1)} BPM</td>
                      <td className="py-0.5">{RELATION_LABEL[candidate.relation]}</td>
                      <td className="py-0.5 text-right">{candidate.periodicity.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </section>
  );
}

function NoisePanel() {
  const noise = useStore(insightsStore, (s) => s.noise);
  return (
    <section className="border-b border-line px-3 py-3">
      <Explained metric="noiseFloor">
        <Heading>Background noise</Heading>
      </Explained>
      {!noise ? (
        <Pending label="Measuring…" />
      ) : (
        <div className="mt-1 space-y-1 text-sm tabular-nums">
          <p data-testid="noise-floor">
            Estimated floor:{" "}
            {noise.noiseFloorDb === null ? "Not available" : formatDb(noise.noiseFloorDb)}
          </p>
          {noise.snrDb !== null && (
            <p data-testid="noise-snr">Estimated SNR: {formatDb(noise.snrDb, "dB")}</p>
          )}
          <p className="text-xs text-muted" data-testid="noise-confidence">
            Confidence: {noise.confidence}
            {noise.interval &&
              ` · quietest run ${formatTimePrecise(noise.interval.start)} to ${formatTimePrecise(noise.interval.end)}`}
          </p>
          {noise.reason && <p className="text-xs text-muted">{noise.reason}</p>}
          <p className="text-xs text-faint">
            Method: 5th percentile of 50 ms RMS. Assumes the quietest passages hold only background.
          </p>
          <Explained metric="hum">
            <p className="text-xs text-muted" data-testid="hum">
              {noise.hum.length === 0
                ? "No narrow peak at 50 or 60 Hz"
                : noise.hum
                    .map(
                      (h) =>
                        `Narrow peak at ${h.frequencyHz} Hz, ${formatDb(h.levelDb, "dB")}: possible hum`,
                    )
                    .join("; ")}
            </p>
          </Explained>
          <Explained metric="zeroCrossingRate">
            <p className="text-xs text-muted">
              Zero-crossing rate:{" "}
              {noise.zeroCrossingRate === null
                ? "Not defined"
                : `${noise.zeroCrossingRate.toFixed(0)} /s`}
            </p>
          </Explained>
        </div>
      )}
    </section>
  );
}

function PitchPanel() {
  const pitch = useStore(insightsStore, (s) => s.pitch);
  const time = useStore(selectionStore, (s) => s.time);
  const duration = useStore(audioStore, (s) => s.recording?.decoded.duration ?? 0);
  const spectrum = useStore(audioStore, (s) => s.spectrum);
  const progress = useStore(audioStore, (s) => s.progress.pitch);
  const summary = useMemo(
    () => (pitch ? summarisePitch(pitch, time?.start ?? 0, time?.end ?? duration) : null),
    [pitch, time, duration],
  );
  const harmonics = useMemo(
    () =>
      spectrum && summary?.medianHz
        ? analyseHarmonics(spectrum.levelDb, spectrum.sampleRate, spectrum.fftSize, summary.medianHz)
        : null,
    [spectrum, summary],
  );
  const note = summary?.medianHz ? frequencyToNote(summary.medianHz) : null;
  return (
    <section className="border-b border-line">
      <div className="px-3 pt-2">
        <Explained metric="pitch">
          <Heading>Pitch</Heading>
        </Explained>
        {!summary ? (
          <Pending label={`Measuring ${Math.round(progress * 100)}%…`} />
        ) : summary.medianHz === null ? (
          <p className="mt-1 text-sm text-muted" data-testid="pitch-summary">
            No reliable pitch here. The audio is not periodic enough for a single fundamental.
          </p>
        ) : (
          <p className="mt-1 text-sm tabular-nums" data-testid="pitch-summary">
            Median {formatHz(summary.medianHz)} ({note?.name}) · pitched in{" "}
            {Math.round(summary.voicedRatio * 100)}% of frames
          </p>
        )}
        <p className="pb-1 text-xs text-faint">
          One periodic source only: not a transcription of chords or mixes. Frames with aperiodicity
          above {MAX_APERIODICITY} are left blank.
        </p>
      </div>
      <PitchChart />
      {summary?.medianHz != null && (
        <div className="grid gap-x-6 px-3 py-2 md:grid-cols-2">
          <div>
            <Explained metric="harmonics">
              <Heading>Harmonics of the median pitch</Heading>
            </Explained>
            {harmonics && !harmonics.resolvable ? (
              <p className="mt-1 text-xs text-muted">
                FFT {spectrum?.fftSize} is too coarse to separate these harmonics. Raise the FFT
                size.
              </p>
            ) : (
              <table className="mt-1 w-full text-xs tabular-nums" data-testid="harmonics">
                <thead>
                  <tr className="text-left text-faint">
                    <th className="py-0.5 font-normal">n</th>
                    <th className="py-0.5 text-right font-normal">Measured</th>
                    <th className="py-0.5 text-right font-normal">Level re n=1</th>
                    <th className="py-0.5 text-right font-normal">Offset</th>
                  </tr>
                </thead>
                <tbody>
                  {harmonics?.rows.map((row) => (
                    <tr key={row.number} className="border-t border-line">
                      <td className="py-0.5">{row.number}</td>
                      <td className="py-0.5 text-right">
                        {row.measuredHz === null ? "—" : formatHz(row.measuredHz)}
                      </td>
                      <td className="py-0.5 text-right">
                        {row.relativeDb === null ? "—" : formatDb(row.relativeDb, "dB")}
                      </td>
                      <td className="py-0.5 text-right">
                        {row.deviationCents === null
                          ? "—"
                          : `${row.deviationCents.toFixed(0).replace("-", "−")}¢`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="mt-2 md:mt-0">
            <Explained metric="harmonicToNoise">
              <Heading>Harmonic-to-noise ratio</Heading>
            </Explained>
            <p className="mt-1 text-sm tabular-nums" data-testid="hnr">
              {summary.harmonicToNoiseDb === null
                ? "Above the measurable range"
                : formatDb(summary.harmonicToNoiseDb, "dB")}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

export function InsightPanels() {
  const channel = useStore(settingsStore, (s) => s.channel);
  const labels = useStore(audioStore, (s) => s.recording?.decoded.channelLabels);
  const hasSelection = useStore(selectionStore, (s) => s.time !== null);

  useEffect(() => {
    setInsightsActive(true);
    return () => setInsightsActive(false);
  }, []);

  return (
    <div>
      <p className="border-b border-line px-3 py-1.5 text-xs text-faint">
        All results here are estimates from {channelSelectionLabel(channel, labels)}. Onsets and the
        pitch track cover the whole recording; tempo, noise and pitch figures cover{" "}
        {hasSelection ? "the selected time range" : "the whole recording"}.
      </p>
      <OnsetPanel />
      <div className="grid md:grid-cols-2">
        <TempoPanel />
        <NoisePanel />
      </div>
      <PitchPanel />
    </div>
  );
}
