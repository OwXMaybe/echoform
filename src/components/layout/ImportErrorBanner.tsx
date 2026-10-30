"use client";

import { CircleAlert, X } from "lucide-react";
import { audioStore } from "@/stores/audio-store";
import { useStore } from "@/stores/create-store";

export function ImportErrorBanner() {
  const error = useStore(audioStore, (s) => s.importError);
  if (!error) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 border-b border-danger/40 bg-danger/10 px-4 py-2 text-sm"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
      <p className="flex-1">{error}</p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => audioStore.set({ importError: null })}
        className="text-muted hover:text-ink"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
