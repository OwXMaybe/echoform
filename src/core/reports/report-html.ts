import type { AnalysisReport } from "./report";

const escapeHtml = (value: unknown): string =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const NOT_DEFINED = "Not defined";
const fixed = (value: number | null | undefined, digits = 2, unit = "") =>
  value === null || value === undefined
    ? NOT_DEFINED
    : `${value.toFixed(digits).replace("-", "−")}${unit ? ` ${unit}` : ""}`;

function table(headers: string[], rows: unknown[][]): string {
  const head = headers.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join("");
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function facts(items: Array<[string, unknown]>): string {
  const rows = items
    .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
    .join("");
  return `<dl>${rows}</dl>`;
}

const section = (title: string, body: string) =>
  `<section><h2>${escapeHtml(title)}</h2>${body}</section>`;

const absent = (text: string) => `<p class="note">${escapeHtml(text)}</p>`;

const CHART_WIDTH = 680;
const CHART_HEIGHT = 200;
const CHART_LEFT = 44;
const CHART_BOTTOM = 22;
const CHART_FLOOR_DB = -120;

/** The computed spectrum as an inline vector chart, so the file stands alone. */
function spectrumChart(report: AnalysisReport): string {
  const curve = report.spectrumCurve;
  if (!curve || curve.frequencyHz.length < 2) return "";
  const { frequencyHz: hz, levelDb: db } = curve;
  const plotWidth = CHART_WIDTH - CHART_LEFT - 8;
  const plotHeight = CHART_HEIGHT - CHART_BOTTOM - 6;
  const min = hz[0];
  const max = hz[hz.length - 1];
  const x = (f: number) => CHART_LEFT + (Math.log(f / min) / Math.log(max / min)) * plotWidth;
  const y = (level: number) =>
    6 + (Math.max(CHART_FLOOR_DB, Math.min(0, level)) / CHART_FLOOR_DB) * plotHeight;
  const points = hz.map((f, i) => `${x(f).toFixed(1)},${y(db[i]).toFixed(1)}`).join(" ");
  const yTicks = [0, -40, -80, -120]
    .map(
      (level) =>
        `<line x1="${CHART_LEFT}" x2="${CHART_WIDTH - 8}" y1="${y(level)}" y2="${y(level)}" class="grid"/>` +
        `<text x="${CHART_LEFT - 6}" y="${y(level) + 3}" text-anchor="end">${String(level).replace("-", "−")}</text>`,
    )
    .join("");
  const xTicks = [100, 1000, 10000]
    .filter((f) => f > min && f < max)
    .map(
      (f) =>
        `<line x1="${x(f)}" x2="${x(f)}" y1="6" y2="${6 + plotHeight}" class="grid"/>` +
        `<text x="${x(f)}" y="${CHART_HEIGHT - 6}" text-anchor="middle">${f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`}</text>`,
    )
    .join("");
  const peak = Math.max(...db);
  return `<figure><svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-label="Average spectrum, highest level ${peak.toFixed(1)} dB">${yTicks}${xTicks}<polyline points="${points}" class="curve"/></svg><figcaption>Average spectrum in dB relative to a full-scale sine. Each point is the strongest bin in its band.</figcaption></figure>`;
}

const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; padding: 32px; background: #fff; color: #17202e; font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 760px; margin: 0 auto; }
h1 { margin: 0; font-size: 22px; }
h2 { margin: 28px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #c9d1dc; font-size: 14px; }
.meta, .note, figcaption { color: #4a5668; font-size: 12px; }
dl { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 2px 20px; margin: 0; }
dl div { display: flex; justify-content: space-between; gap: 12px; padding: 2px 0; }
dt { color: #4a5668; }
dd { margin: 0; font-variant-numeric: tabular-nums; text-align: right; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th { color: #4a5668; font-weight: 500; text-align: left; }
th, td { padding: 3px 8px 3px 0; border-bottom: 1px solid #e3e8ee; vertical-align: top; }
figure { margin: 12px 0 0; }
svg { display: block; width: 100%; height: auto; }
svg text { fill: #4a5668; font-size: 10px; }
.grid { stroke: #e3e8ee; }
.curve { fill: none; stroke: #0e7490; stroke-width: 1.5; stroke-linejoin: round; }
.warning { padding: 6px 10px; border-left: 3px solid #b45309; background: #fef3c7; }
code { font: 11px ui-monospace, monospace; }
section { break-inside: avoid-page; }
@media print { body { padding: 0; } h2 { break-after: avoid; } }
`;

/** A self-contained document: no scripts and no external requests, safe to open or print. */
export function reportToHtml(report: AnalysisReport): string {
  const { recording: r, file, scope, configuration: c } = report;
  const name = r.fileName ?? "Recording";
  const parts: string[] = [];

  parts.push(
    section(
      "Recording",
      facts([
        ["Duration", `${r.durationSeconds.toFixed(3)} s`],
        ["Sample rate", `${r.sampleRate} Hz`],
        ["Channels", r.channelLabels.join(", ")],
        ["Samples", r.frameCount],
      ]) + report.warnings.map((w) => `<p class="warning">${escapeHtml(w)}</p>`).join(""),
    ),
  );
  parts.push(
    section(
      "File metadata",
      facts([
        ["Format", file.format],
        ["Encoding", file.encoding ?? "Not stored"],
        ["Size", `${file.sizeBytes} bytes`],
        ["Sample rate", file.sampleRate ? `${file.sampleRate} Hz` : "Not read"],
        ["Channels", file.channelCount ?? "Not read"],
        ["Bit depth", file.bitDepth ? `${file.bitDepth}-bit` : "Not stored"],
      ]),
    ),
  );
  parts.push(
    section(
      "Analysis configuration",
      facts([
        ["Scope", `${scope.kind}, ${scope.startSeconds.toFixed(3)} to ${scope.endSeconds.toFixed(3)} s`],
        ["Band", scope.band ? `${fixed(scope.band.minHz, 1)} to ${fixed(scope.band.maxHz, 1)} Hz` : "All"],
        ["Channel", c.channel],
        ["FFT size", c.fftSize],
        ["Hop", c.hopSize],
        ["Window", c.windowFunction],
        ["Rolloff", `${c.rolloffPercent}%`],
        ["Peak prominence", `${c.peakProminenceDb} dB`],
        ["Silence threshold", `${c.silenceThresholdDb} dBFS`],
        ["Silence minimum", `${c.silenceMinSeconds} s`],
        ["DC warning", c.dcWarningThreshold],
      ]),
    ),
  );
  parts.push(
    section(
      "Time-domain measurements",
      report.timeDomain
        ? table(
            ["Channel", "Peak", "RMS", "Crest", "Mean", "At full scale"],
            report.timeDomain.map((m) => [
              m.channel,
              fixed(m.peakDbfs, 2, "dBFS"),
              fixed(m.rmsDbfs, 2, "dBFS"),
              fixed(m.crestFactorDb, 2, "dB"),
              m.mean.toExponential(2),
              m.samplesAtFullScale,
            ]),
          )
        : absent("Not computed."),
    ),
  );
  const f = report.frequencyDomain;
  parts.push(
    section(
      "Frequency-domain measurements",
      f
        ? facts([
            ["Resolution", `${f.frequencyResolutionHz.toFixed(2)} Hz`],
            ["Frames averaged", f.framesAveraged],
          ]) +
            (f.peaks.length
              ? table(
                  ["Frequency", "Level", "Prominence", "Band"],
                  f.peaks.map((p) => [
                    fixed(p.frequencyHz, 1, "Hz"),
                    fixed(p.levelDb, 1, "dB"),
                    fixed(p.prominenceDb, 1, "dB"),
                    p.band,
                  ]),
                )
              : absent("No prominent peaks.")) +
            spectrumChart(report)
        : absent("Not computed."),
    ),
  );
  const s = report.spectral;
  parts.push(
    section(
      "Spectral characteristics",
      s
        ? facts([
            ["Centroid", fixed(s.centroidHz, 1, "Hz")],
            [`Rolloff (${c.rolloffPercent}%)`, fixed(s.rolloffHz, 1, "Hz")],
            ["Flatness", fixed(s.flatness, 4)],
            ["Zero-crossing rate", fixed(s.zeroCrossingRate, 0, "per s")],
          ])
        : absent("Not computed."),
    ),
  );
  const ch = report.channelAnalysis;
  parts.push(
    section(
      "Channel analysis",
      ch
        ? facts([
            ["Correlation", fixed(ch.correlation, 3)],
            ["Level difference (L − R)", fixed(ch.levelDifferenceDb, 2, "dB")],
            ["Mid RMS", fixed(ch.midRmsDb, 2, "dBFS")],
            ["Side RMS", fixed(ch.sideRmsDb, 2, "dBFS")],
            ["Width index", fixed(ch.width, 3)],
          ])
        : absent(`Stereo measurements need exactly two channels; this recording has ${r.channelCount}.`),
    ),
  );
  const silence = report.silence;
  parts.push(
    section(
      "Silence regions",
      silence
        ? absentOr(silence.regions.length > 0, "No regions found.", () =>
            table(
              ["Start", "End", "Length", "Kind"],
              silence.regions.map((x) => [
                fixed(x.start, 3, "s"),
                fixed(x.end, 3, "s"),
                fixed(x.duration, 3, "s"),
                x.kind,
              ]),
            ),
          ) + `<p class="note">Threshold ${silence.options.thresholdDb} dBFS, ${(silence.ratio * 100).toFixed(1)}% of the recording.</p>`
        : absent("Not computed."),
    ),
  );
  const clipping = report.clipping;
  parts.push(
    section(
      "Clipping analysis",
      clipping
        ? `<p>${clipping.clippedSamples} samples in ${clipping.totalIntervals} intervals.</p>` +
            (clipping.intervals.length
              ? table(
                  ["Start", "End", "Samples", "Channels"],
                  clipping.intervals.map((x) => [
                    fixed(x.start, 3, "s"),
                    fixed(x.end, 3, "s"),
                    x.clippedSamples,
                    x.channels.join(", "),
                  ]),
                )
              : "")
        : absent("Not computed."),
    ),
  );
  const filters = report.filters;
  if (filters) {
    parts.push(
      section(
        "Filter settings",
        table(
          ["Type", "Frequency", "Q", "Gain", "Order"],
          filters.list.map((x) => [
            x.filterType,
            fixed(x.frequency, 1, "Hz"),
            fixed(x.q, 2),
            fixed(x.gainDb, 1, "dB"),
            x.order,
          ]),
        ) +
          `<p class="note">Measurements above describe the original recording. Processed peak ${fixed(filters.processedPeakDbfs, 2, "dBFS")}, RMS ${fixed(filters.processedRmsDbfs, 2, "dBFS")}.</p>`,
      ),
    );
  }
  const m = report.comparison;
  if (m) {
    const { a, b } = m;
    const row = (label: string, pick: (x: typeof a) => string) => [label, pick(a), pick(b)];
    parts.push(
      section(
        "Comparison",
        `<p>Against ${escapeHtml(m.referenceFileName ?? "a second recording")}. ${escapeHtml(m.alignmentMethod)}, B offset ${fixed(m.offsetSeconds, 3, "s")}${m.alignmentMatch === null ? "" : `, match ${fixed(m.alignmentMatch, 3)}`}. Compared ${fixed(m.comparedSeconds, 3, "s")}; normalisation ${escapeHtml(m.normalisation)}.</p>` +
          table(
            ["Metric", "A", "B"],
            [
              row("Peak", (x) => fixed(x.peakDb, 2, "dBFS")),
              row("RMS", (x) => fixed(x.rmsDb, 2, "dBFS")),
              row("Centroid", (x) => fixed(x.centroidHz, 1, "Hz")),
              row("Rolloff", (x) => fixed(x.rolloffHz, 1, "Hz")),
              row("Flatness", (x) => fixed(x.flatness, 4)),
              row("Zero-crossing rate", (x) => fixed(x.zeroCrossingRate, 0, "per s")),
              row("Correlation", (x) => fixed(x.correlation, 3)),
              row("Short-term range", (x) => fixed(x.dynamicRangeDb, 2, "dB")),
            ],
          ),
      ),
    );
  }
  const e = report.events;
  if (e) {
    parts.push(
      section(
        "Events, pitch and noise (estimates)",
        facts([
          ["Onsets", `${e.onsetSeconds.length} at sensitivity ${Math.round(e.onsetSensitivity * 100)}%`],
          ["Tempo", e.tempo?.bpm ? `${e.tempo.bpm.toFixed(1)} BPM, confidence ${e.tempo.confidence.toFixed(2)}` : "No clear tempo"],
          ["Median pitch", e.pitch?.medianHz ? `${e.pitch.medianHz.toFixed(1)} Hz` : "No reliable pitch"],
          ["Noise floor", e.noise?.noiseFloorDb === null || !e.noise ? "Not available" : `${e.noise.noiseFloorDb.toFixed(2)} dBFS, ${e.noise.confidence} confidence`],
          ["SNR", e.noise?.snrDb === null || !e.noise ? "Not available" : `${e.noise.snrDb.toFixed(2)} dB`],
        ]) + (e.noise?.reason ? absent(e.noise.reason) : ""),
      ),
    );
  }
  parts.push(
    section(
      "Methodology",
      report.methodology
        .map(
          (x) =>
            `<p><strong>${escapeHtml(x.title)}</strong> (${escapeHtml(x.kind.toLowerCase())})${x.formula ? ` <code>${escapeHtml(x.formula)}</code>` : ""}<br>${escapeHtml(x.meaning)}</p>`,
        )
        .join(""),
    ),
  );
  parts.push(
    section(
      "Limitations",
      `<ul>${report.limitations.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`,
    ),
  );

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(name)}: ECHOFORM report</title><style>${STYLE}</style></head><body><main><h1>${escapeHtml(name)}</h1><p class="meta">ECHOFORM analysis report, generated ${escapeHtml(report.generatedAt)}. Processed locally in the browser.</p>${parts.join("")}</main></body></html>`;
}

function absentOr(present: boolean, text: string, render: () => string): string {
  return present ? render() : absent(text);
}
