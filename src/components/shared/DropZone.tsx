"use client";

import { FileAudio, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { createDemoSignal } from "@/core/audio/test-signals";
import { encodeWav16 } from "@/core/audio/wav";
import { audioStore, openFile } from "@/stores/audio-store";
import { useStore } from "@/stores/create-store";
import { AUDIO_ACCEPT } from "./OpenFileButton";

export function DropZone() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const stage = useStore(audioStore, (s) => s.importStage);

  const open = async (file: File | undefined) => {
    if (file && (await openFile(file))) router.push("/workspace");
  };

  const openDemo = () => {
    const demo = createDemoSignal();
    const wav = encodeWav16(demo.channels, demo.sampleRate);
    void open(new File([wav], demo.name, { type: "audio/wav" }));
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void open(event.dataTransfer.files[0]);
      }}
      className={`flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center transition-colors ${
        dragging ? "border-accent bg-accent/5" : "border-line bg-surface"
      }`}
    >
      {stage ? (
        <>
          <Loader2 className="size-7 animate-spin text-accent" aria-hidden />
          <p className="text-sm text-muted">{stage}…</p>
        </>
      ) : (
        <>
          <FileAudio className="size-7 text-muted" aria-hidden />
          <div>
            <p className="font-medium">Drop an audio file here</p>
            <p className="mt-1 text-sm text-muted">It stays on this device. Nothing is uploaded.</p>
          </div>
          <input
            ref={input}
            type="file"
            accept={AUDIO_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose audio file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void open(file);
            }}
          />
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-deep hover:bg-accent/90"
            >
              Choose file
            </button>
            <button
              type="button"
              onClick={openDemo}
              title="Generates a known stereo signal in your browser"
              className="rounded-md border border-line px-3.5 py-2 text-sm hover:bg-raised"
            >
              Use test signal
            </button>
          </div>
        </>
      )}
    </div>
  );
}
