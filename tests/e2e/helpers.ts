import type { Page } from "@playwright/test";
import { addSignals, sine, whiteNoise } from "../../src/core/audio/test-signals";
import { encodeWav16 } from "../../src/core/audio/wav";

export const RATE = 48000;

export function wavFile(name: string, channels: Float32Array[], rate = RATE) {
  return {
    name,
    mimeType: "audio/wav",
    buffer: Buffer.from(encodeWav16(channels, rate)),
  };
}

/** Stereo: a tone in both channels, louder on the left, over quiet independent noise. */
export function stereoTone(seconds = 4) {
  const n = RATE * seconds;
  const left = addSignals(sine(1000, 0.4, RATE, n), whiteNoise(0.01, n, 11));
  const right = addSignals(sine(1000, 0.2, RATE, n), whiteNoise(0.01, n, 22));
  return [left, right];
}

export async function openRecording(page: Page, file: ReturnType<typeof wavFile>) {
  await page.getByTestId("file-input").setInputFiles(file);
  await page.getByTestId("waveform").waitFor();
}

/** Client-side navigation: a full page load would discard the open recording. */
export async function goTo(page: Page, label: string) {
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: label }).click();
}
