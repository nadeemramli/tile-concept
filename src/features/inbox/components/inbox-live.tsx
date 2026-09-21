"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { formatDateTime } from "@/lib/format";

type Connection = "connecting" | "live" | "fallback" | "offline";
const LABELS: Record<Connection, string> = {
  connecting: "Connecting live updates…", live: "Live updates connected",
  fallback: "Live connection unavailable · checking every minute", offline: "Offline · showing last loaded data",
};

/** Broadcasts only invalidate. All inquiry data is re-read by the server with
 * current permissions. Refresh keeps filters, drawer selection and draft input.
 *
 * A refresh re-renders the whole route (shell counters included), so it is
 * rate-limited: a broadcast or a tab returning to the foreground triggers one
 * at most once per MIN_REFRESH_GAP, and the timer only covers the cases the
 * channel cannot: a lost connection, and due dates crossing "now". */
const MIN_REFRESH_GAP = 15_000;
const CONNECTED_TICK = 5 * 60_000;
const FALLBACK_TICK = 60_000;
export function InboxLive({ workspaceId, refreshedAt }: { workspaceId: string; refreshedAt: string }) {
  const router = useRouter();
  const [connection, setConnection] = useState<Connection>("connecting");
  const [pending, start] = useTransition();

  useEffect(() => {
    const client = getBrowserSupabase();
    let active = true;
    let connected = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastRefresh = Date.now();
    const refresh = (force = false) => {
      if (!active || document.visibilityState === "hidden" || !navigator.onLine || timer) return;
      if (!force && Date.now() - lastRefresh < MIN_REFRESH_GAP) return;
      // Coalesce a transaction's lead/task/activity signals and bulk imports.
      timer = setTimeout(() => {
        timer = undefined;
        if (active && document.visibilityState !== "hidden" && navigator.onLine) {
          lastRefresh = Date.now();
          start(() => router.refresh());
        }
      }, 800);
    };
    const onSignal = () => refresh();
    const channel = client.channel(`inquiries:${workspaceId}`, { config: { private: true } })
      .on("broadcast", { event: "inbox_changed" }, onSignal);
    void client.realtime.setAuth().then(() => {
      if (!active) return;
      channel.subscribe((status) => {
        if (!active) return;
        connected = status === "SUBSCRIBED";
        setConnection(!navigator.onLine ? "offline" : connected ? "live" : "fallback");
        // Covers changes missed while reconnecting. Throttled, so the first
        // subscribe right after the page rendered does not re-render it.
        if (connected) refresh();
      });
    }).catch(() => { if (active) setConnection(navigator.onLine ? "fallback" : "offline"); });
    const visibility = () => { if (document.visibilityState !== "hidden") refresh(); };
    const offline = () => { connected = false; setConnection("offline"); };
    const online = () => { setConnection("fallback"); refresh(true); };
    // Connected: an occasional tick keeps time-based due queues current.
    // Fallback: poll once a minute. Hidden tabs do no background server queries.
    const poll = setInterval(() => {
      if (!connected) refresh();
      else if (Date.now() - lastRefresh >= CONNECTED_TICK) refresh();
    }, FALLBACK_TICK);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", onSignal);
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", onSignal);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      void client.removeChannel(channel);
    };
  }, [router, workspaceId]);

  return <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
    <span role="status">{pending ? "Refreshing inquiries…" : LABELS[connection]} <span className="whitespace-nowrap">· Loaded {formatDateTime(refreshedAt)}</span></span>
    <Button size="sm" variant="ghost" disabled={pending || connection === "offline"} onClick={() => start(() => router.refresh())}>
      <RefreshCw className="size-3.5" aria-hidden /> Refresh now
    </Button>
  </div>;
}
