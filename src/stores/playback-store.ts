import { PlaybackEngine } from "@/core/audio/playback";
import { createStore } from "./create-store";
import { selectionStore } from "./selection-store";

export const playback = new PlaybackEngine();

export const playbackStore = createStore({
  isPlaying: false,
  volume: 1,
  muted: false,
  rate: 1,
  loop: false,
  /** Bumped on every discrete position change, so paused views repaint the playhead. */
  seekCount: 0,
});

playback.onEnded = () => playbackStore.set({ isPlaying: false });

export function seekTo(seconds: number): void {
  playback.seek(seconds);
  playbackStore.set({ seekCount: playbackStore.get().seekCount + 1 });
}

export async function togglePlay(): Promise<void> {
  if (playback.playing) {
    playback.pause();
    playbackStore.set({ isPlaying: false });
  } else {
    await playback.play();
    playbackStore.set({ isPlaying: playback.playing });
  }
}

export function stopPlayback(): void {
  playback.stop();
  playbackStore.set({ isPlaying: false, seekCount: playbackStore.get().seekCount + 1 });
}

export function setVolume(volume: number): void {
  playbackStore.set({ volume, muted: false });
  playback.setGain(volume);
}

export function toggleMute(): void {
  const { muted, volume } = playbackStore.get();
  playbackStore.set({ muted: !muted });
  playback.setGain(muted ? volume : 0);
}

export function setRate(rate: number): void {
  playbackStore.set({ rate });
  playback.setRate(rate);
}

function syncLoop(): void {
  const { loop } = playbackStore.get();
  const { time } = selectionStore.get();
  playback.setLoop(loop && time ? time : null);
}

export function toggleLoop(): void {
  playbackStore.set({ loop: !playbackStore.get().loop });
  syncLoop();
}

let lastTime = selectionStore.get().time;
selectionStore.subscribe(() => {
  const { time } = selectionStore.get();
  if (time === lastTime) return;
  lastTime = time;
  if (playbackStore.get().loop) syncLoop();
});
