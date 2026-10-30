import { useSyncExternalStore } from "react";

export interface Store<T> {
  /** What the server rendered; hydration must match this, whatever has happened since. */
  readonly initial: T;
  get(): T;
  set(patch: Partial<T>): void;
  subscribe(listener: () => void): () => void;
}

/** Minimal external store: state lives outside React, so typed arrays are never copied or diffed. */
export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    initial,
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useStore<T extends object, R>(store: Store<T>, selector: (state: T) => R): R {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.initial),
  );
}
