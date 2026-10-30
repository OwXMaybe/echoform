"use client";

import { Braces, Code2, Printer, Table } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { DropZone } from "@/components/shared/DropZone";
import { buildReport, reportFileName, reportToCsv, reportToJson } from "@/core/reports/report";
import { reportToHtml } from "@/core/reports/report-html";
import { audioStore } from "@/stores/audio-store";
import { comparisonStore } from "@/stores/comparison-store";
import { useStore } from "@/stores/create-store";
import { filterStore } from "@/stores/filter-store";
import { insightsStore, setInsightsActive } from "@/stores/insights-store";
import { collectReportInput, pendingMeasurements } from "@/stores/report-input";
import { selectionStore } from "@/stores/selection-store";
import { settingsStore } from "@/stores/settings-store";
import { saveBlob } from "@/utils/export-image";
import { formatTimePrecise } from "@/utils/formatting";

function ExportButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-raised disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {icon}
      {label}
    </button>
  );
}

function ReportBuilder() {
  const frame = useRef<HTMLIFrameElement>(null);
  const audio = useStore(audioStore, (s) => s);
  const insights = useStore(insightsStore, (s) => s);
  const filters = useStore(filterStore, (s) => s);
  const compare = useStore(comparisonStore, (s) => s);
  const settings = useStore(settingsStore, (s) => s);
  const selection = useStore(selectionStore, (s) => s);
  const time = selection.time;

  useEffect(() => {
    setInsightsActive(true);
    return () => setInsightsActive(false);
  }, []);

  // The stores are the dependencies: a change to any of them is a change to the report.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pending = useMemo(() => pendingMeasurements(), [audio, insights, compare]);
  const report = useMemo(() => {
    const input = pending.length === 0 ? collectReportInput() : null;
    return input ? buildReport(input) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.length, audio, insights, filters, compare, settings, selection]);
  const html = useMemo(() => (report ? reportToHtml(report) : ""), [report]);

  const save = (text: string, type: string, extension: string) => {
    if (report) saveBlob(new Blob([text], { type }), reportFileName(report, extension));
  };

  return (
    <div className="flex min-h-full flex-col">
      <header className="space-y-1.5 border-b border-line bg-surface px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-2 text-sm font-semibold">Analysis report</h1>
          <ExportButton
            label="JSON"
            icon={<Braces className="size-3.5" aria-hidden />}
            disabled={!report}
            onClick={() => save(reportToJson(report!), "application/json", "json")}
          />
          <ExportButton
            label="CSV"
            icon={<Table className="size-3.5" aria-hidden />}
            disabled={!report}
            onClick={() => save(reportToCsv(report!), "text/csv;charset=utf-8", "csv")}
          />
          <ExportButton
            label="HTML"
            icon={<Code2 className="size-3.5" aria-hidden />}
            disabled={!report}
            onClick={() => save(html, "text/html;charset=utf-8", "html")}
          />
          <ExportButton
            label="Print"
            icon={<Printer className="size-3.5" aria-hidden />}
            disabled={!report}
            onClick={() => frame.current?.contentWindow?.print()}
          />
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={settings.reportIncludeFileNames}
              onChange={(event) =>
                settingsStore.set({ reportIncludeFileNames: event.target.checked })
              }
            />
            Include file names
          </label>
        </div>
        <p className="text-xs text-muted" role="status" data-testid="report-status">
          {pending.length > 0
            ? `Waiting for ${pending.join(", ")}. Export is available once these finish.`
            : "Ready. Every figure below comes from the analysis of this recording."}
        </p>
        <p className="text-xs text-faint" data-testid="report-scope">
          Scope:{" "}
          {time
            ? `selection ${formatTimePrecise(time.start)} to ${formatTimePrecise(time.end)}`
            : "whole recording"}
          . Change it in the{" "}
          <Link href="/workspace" className="text-accent underline">
            Workspace
          </Link>
          ; analysis options are in{" "}
          <Link href="/settings" className="text-accent underline">
            Settings
          </Link>
          . Reports are created in this browser and leave it only if you save or share them.
        </p>
      </header>
      {report && (
        <iframe
          ref={frame}
          title="Report preview"
          data-testid="report-preview"
          srcDoc={html}
          // Same origin lets the Print button reach it. Without allow-scripts nothing inside runs.
          sandbox="allow-same-origin allow-modals"
          className="min-h-[32rem] w-full flex-1 bg-white"
        />
      )}
    </div>
  );
}

export default function ReportsPage() {
  const hasRecording = useStore(audioStore, (s) => s.recording !== null);
  if (!hasRecording) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="mb-1 text-lg font-semibold">Reports</h1>
        <p className="mb-4 text-sm text-muted">Open a recording to build a report from it.</p>
        <DropZone />
      </div>
    );
  }
  return <ReportBuilder />;
}
