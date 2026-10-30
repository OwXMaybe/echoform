"use client";

import { Loader2, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { OpenFileButton } from "@/components/shared/OpenFileButton";
import { audioStore, closeRecording, type AudioState } from "@/stores/audio-store";
import { useStore } from "@/stores/create-store";

const STATUS_NAMES: Partial<Record<keyof AudioState["status"], string>> = {
  spectrogramDetail: "zoom detail",
  filter: "filters",
  processedSpectrum: "processed spectrum",
  offset: "alignment",
  compare: "comparison",
  novelty: "onsets",
  noise: "noise",
};

function statusText(state: AudioState): string | null {
  if (state.importStage) return `${state.importStage}…`;
  if (!state.recording) return null;
  const running = (Object.keys(state.status) as (keyof AudioState["status"])[]).filter(
    (k) => state.status[k] === "running",
  );
  if (running.length > 0) {
    const label = running.includes("spectrogram") ? "spectrogram" : running[0];
    const name = STATUS_NAMES[label] ?? label;
    return `Analysing ${name} ${Math.round(state.progress[label] * 100)}%`;
  }
  if (Object.values(state.status).includes("error")) return "Analysis error";
  return "Analysis complete";
}

export function TopBar() {
  const router = useRouter();
  const name = useStore(audioStore, (s) => s.recording?.original.name ?? null);
  const status = useStore(audioStore, statusText);
  const busy = useStore(
    audioStore,
    (s) => s.importStage !== null || Object.values(s.status).includes("running"),
  );

  return (
    <header className="flex items-center gap-3 border-b border-line bg-surface px-3 py-2 md:px-4">
      <span className="text-sm font-semibold tracking-[0.18em] md:hidden">ECHOFORM</span>
      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
        <span className="hidden text-faint sm:inline">Unsaved session</span>
        {name && (
          <>
            <span className="hidden text-faint sm:inline">/</span>
            <span className="truncate font-medium">{name}</span>
          </>
        )}
      </div>
      {status && (
        <span
          role="status"
          className="hidden items-center gap-1.5 text-xs tabular-nums text-muted sm:flex"
        >
          {busy && <Loader2 className="size-3.5 animate-spin text-accent" aria-hidden />}
          {status}
        </span>
      )}
      <span
        className="hidden items-center gap-1.5 text-xs text-muted lg:flex"
        title="Audio is decoded and analysed in this browser tab. Nothing is uploaded or saved."
      >
        <ShieldCheck className="size-3.5" aria-hidden />
        Local only
      </span>
      <OpenFileButton
        label={name ? "Replace" : "Open audio"}
        onOpened={() => router.push("/workspace")}
      />
      {name && (
        <button
          type="button"
          onClick={() => {
            closeRecording();
            router.push("/");
          }}
          aria-label="Close recording"
          title="Close recording and release its memory"
          className="rounded-md p-1.5 text-muted hover:bg-raised hover:text-ink"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </header>
  );
}
