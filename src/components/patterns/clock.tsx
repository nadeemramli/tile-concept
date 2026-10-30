"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

/**
 * One clock for time-relative labels ("42 minutes ago", freshness tone).
 *
 * The server render and the hydrating client render must read the same
 * instant, or a label that crosses a minute (or an SLA) between the two is a
 * hydration mismatch (TILE-68). `ClockProvider` carries the request's render
 * time to the client; while hydrating, `useNow()` returns it, then React
 * re-renders with the browser's clock and one shared ticker keeps it current.
 * Outside a provider there is no shared instant, so `useNow()` is `null` until
 * the component has mounted and callers render something clock-free.
 */
const ServerNow = createContext<number | null>(null);

export function ClockProvider({ now, children }: { now: number; children: React.ReactNode }) {
  return <ServerNow.Provider value={now}>{children}</ServerNow.Provider>;
}

/** Often enough that a minute label is never more than half a minute behind. */
export const CLOCK_TICK_MS = 30_000;

let current = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

/** Before the ticker runs, a value older than one tick is from a past mount. */
function refreshIfStale() {
  if (!timer && Date.now() - current >= CLOCK_TICK_MS) current = Date.now();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      listeners.forEach((l) => l());
    }, CLOCK_TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

// Between ticks every reader sees the same instant, so repeated reads agree.
function getSnapshot() {
  refreshIfStale();
  return current;
}

export function useNow(): number | null {
  const serverNow = useContext(ServerNow);
  return useSyncExternalStore<number | null>(subscribe, getSnapshot, () => serverNow);
}
