import { createStore } from "./create-store";

export interface TimeRange {
  start: number;
  end: number;
}

export interface FrequencyRange {
  min: number;
  max: number;
}

export interface SelectionState {
  duration: number;
  /** Visible time window, shared by every time-based view. */
  view: TimeRange;
  time: TimeRange | null;
  frequency: FrequencyRange | null;
}

export const selectionStore = createStore<SelectionState>({
  duration: 0,
  view: { start: 0, end: 0 },
  time: null,
  frequency: null,
});

const MIN_VIEW_SECONDS = 0.0005;

export function resetSelection(duration: number): void {
  selectionStore.set({ duration, view: { start: 0, end: duration }, time: null, frequency: null });
}

export function setTimeSelection(a: number, b: number): void {
  const { duration } = selectionStore.get();
  const start = Math.max(0, Math.min(a, b));
  const end = Math.min(duration, Math.max(a, b));
  selectionStore.set({ time: end > start ? { start, end } : null });
}

export function setFrequencySelection(a: number, b: number): void {
  selectionStore.set({ frequency: { min: Math.min(a, b), max: Math.max(a, b) } });
}

export function clearSelection(): void {
  selectionStore.set({ time: null, frequency: null });
}

export function setView(start: number, end: number): void {
  const { duration } = selectionStore.get();
  const span = Math.min(duration, Math.max(MIN_VIEW_SECONDS, end - start));
  const clamped = Math.max(0, Math.min(duration - span, start));
  selectionStore.set({ view: { start: clamped, end: clamped + span } });
}

/** factor < 1 zooms in, keeping `anchor` at the same screen position. */
export function zoomView(factor: number, anchor?: number): void {
  const { view } = selectionStore.get();
  const span = view.end - view.start;
  const pivot = anchor ?? view.start + span / 2;
  const next = span * factor;
  setView(pivot - (pivot - view.start) * factor, pivot - (pivot - view.start) * factor + next);
}

export function panView(deltaSeconds: number): void {
  const { view } = selectionStore.get();
  setView(view.start + deltaSeconds, view.end + deltaSeconds);
}

export function zoomToSelection(): void {
  const { time } = selectionStore.get();
  if (time) setView(time.start, time.end);
}

export function resetView(): void {
  const { duration } = selectionStore.get();
  selectionStore.set({ view: { start: 0, end: duration } });
}
