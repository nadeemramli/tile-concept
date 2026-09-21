import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboxLive } from "./inbox-live";

const mock = vi.hoisted(() => ({
  refresh: vi.fn(), remove: vi.fn(), channel: vi.fn(), broadcast: null as (() => void) | null,
  status: null as ((status: string) => void) | null,
}));
const router = { refresh: mock.refresh };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/supabase/client", () => ({
  getBrowserSupabase: () => ({
    realtime: { setAuth: () => Promise.resolve() }, removeChannel: mock.remove,
    channel: (...args: unknown[]) => {
      mock.channel(...args);
      const channel = {
        on: (_: string, __: unknown, cb: () => void) => { mock.broadcast = cb; return channel; },
        subscribe: (cb: (status: string) => void) => { mock.status = cb; return channel; },
      };
      return channel;
    },
  }),
}));

async function mount() {
  render(<InboxLive workspaceId="workspace-a" refreshedAt="2026-09-21T01:00:00Z" />);
  await act(async () => { await Promise.resolve(); });
}
describe("inbox invalidation updates", () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks(); mock.status = null; mock.broadcast = null;
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("joins only a private workspace topic and coalesces event bursts", async () => {
    await mount();
    expect(mock.channel).toHaveBeenCalledWith("inquiries:workspace-a", { config: { private: true } });
    act(() => { mock.status?.("SUBSCRIBED"); vi.advanceTimersByTime(800); });
    expect(screen.getByRole("status")).toHaveTextContent("Live updates connected");
    // The page was just rendered: subscribing does not re-render it.
    expect(mock.refresh).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(15_000); mock.broadcast?.(); mock.broadcast?.(); vi.advanceTimersByTime(800); });
    expect(mock.refresh).toHaveBeenCalledTimes(1);
  });
  it("rate-limits broadcast-driven refreshes to one per fifteen seconds", async () => {
    await mount();
    act(() => { mock.status?.("SUBSCRIBED"); vi.advanceTimersByTime(15_000); mock.broadcast?.(); vi.advanceTimersByTime(800); });
    expect(mock.refresh).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(5_000); mock.broadcast?.(); window.dispatchEvent(new Event("focus")); vi.advanceTimersByTime(800); });
    expect(mock.refresh).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(10_000); mock.broadcast?.(); vi.advanceTimersByTime(800); });
    expect(mock.refresh).toHaveBeenCalledTimes(2);
  });
  it("catches up on reconnect and polls once a minute without WebSockets", async () => {
    await mount();
    act(() => { mock.status?.("CHANNEL_ERROR"); vi.advanceTimersByTime(60_800); });
    expect(screen.getByRole("status")).toHaveTextContent("checking every minute");
    expect(mock.refresh).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(20_000); mock.status?.("SUBSCRIBED"); vi.advanceTimersByTime(800); });
    expect(mock.refresh).toHaveBeenCalledTimes(2);
    // Connected tabs only tick every five minutes for time-based queues.
    act(() => { vi.advanceTimersByTime(4 * 60_000); });
    expect(mock.refresh).toHaveBeenCalledTimes(2);
    act(() => { vi.advanceTimersByTime(2 * 60_000); });
    expect(mock.refresh).toHaveBeenCalledTimes(3);
  });
  it("pauses hidden/offline refreshes and catches up on visibility or network recovery", async () => {
    await mount();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => { mock.broadcast?.(); vi.advanceTimersByTime(60_800); });
    expect(mock.refresh).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); vi.advanceTimersByTime(800); });
    expect(mock.refresh).toHaveBeenCalledTimes(1);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    act(() => { window.dispatchEvent(new Event("offline")); mock.broadcast?.(); vi.advanceTimersByTime(60_800); });
    expect(screen.getByRole("status")).toHaveTextContent("Offline");
    expect(mock.refresh).toHaveBeenCalledTimes(1);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    act(() => { window.dispatchEvent(new Event("online")); vi.advanceTimersByTime(800); });
    expect(mock.refresh).toHaveBeenCalledTimes(2);
  });
  it("unsubscribes and clears queued refresh work on navigation", async () => {
    await mount();
    act(() => { mock.broadcast?.(); });
    cleanup();
    act(() => { vi.advanceTimersByTime(60_800); mock.status?.("SUBSCRIBED"); });
    expect(mock.remove).toHaveBeenCalledOnce();
    expect(mock.refresh).not.toHaveBeenCalled();
  });
});
