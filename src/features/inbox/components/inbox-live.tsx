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
  fallback: "Live connection unavailable · checking every 30 seconds", offline: "Offline · showing last loaded data",
};

/** Broadcasts only invalidate. All inquiry data is re-read by the server with
 * current permissions. Refresh keeps filters, drawer selection and draft input. */
export function InboxLive({ workspaceId, refreshedAt }: { workspaceId: string; refreshedAt: string }) {
  const router = useRouter();
  const [connection, setConnection] = useState<Connection>("connecting");
  const [pending, start] = useTransition();

  useEffect(() => {
    const client = getBrowserSupabase();
    let active = true;
    let connected = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ticks = 0;
    const refresh = () => {
      if (!active || document.visibilityState === "hidden" || !navigator.onLine || timer) return;
      // Coalesce a transaction's lead/task/activity signals and bulk imports.
      timer = setTimeout(() => {
        timer = undefined;
        if (active && document.visibilityState !== "hidden" && navigator.onLine) start(() => router.refresh());
      }, 800);
    };
    const channel = client.channel(`inquiries:${workspaceId}`, { config: { private: true } })
      .on("broadcast", { event: "inbox_changed" }, refresh);
    void client.realtime.setAuth().then(() => {
      if (!active) return;
      channel.subscribe((status) => {
        if (!active) return;
        connected = status === "SUBSCRIBED";
        setConnection(!navigator.onLine ? "offline" : connected ? "live" : "fallback");
        if (connected) refresh(); // Covers changes missed while reconnecting.
      });
    }).catch(() => { if (active) setConnection(navigator.onLine ? "fallback" : "offline"); });
    const visibility = () => { if (document.visibilityState !== "hidden") refresh(); };
    const offline = () => { connected = false; setConnection("offline"); };
    const online = () => { setConnection("fallback"); refresh(); };
    // Once/minute when connected also updates time-based due queues. Fallback
    // checks every 30 seconds. Hidden tabs do no background server queries.
    const poll = setInterval(() => { ticks += 1; if (!connected || ticks % 2 === 0) refresh(); }, 30_000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", refresh);
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", refresh);
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
