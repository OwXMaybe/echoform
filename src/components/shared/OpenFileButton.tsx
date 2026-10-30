"use client";

import { Upload } from "lucide-react";
import { useRef } from "react";
import { openFile } from "@/stores/audio-store";

export const AUDIO_ACCEPT = "audio/*,.wav,.mp3,.flac,.ogg,.oga,.opus,.m4a,.aac";

export function OpenFileButton({
  label,
  onOpened,
}: {
  label: string;
  onOpened?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={AUDIO_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label={label}
        data-testid="file-input"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file && (await openFile(file))) onOpened?.();
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-raised"
      >
        <Upload className="size-3.5" aria-hidden />
        {label}
      </button>
    </>
  );
}
