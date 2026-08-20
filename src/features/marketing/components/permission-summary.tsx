"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Paperclip, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingPill, Chips } from "@/features/marketing/components/pills";
import { CAPTURE_TYPES, PERMISSION_STATUS, PERMITTED_USES } from "@/features/marketing/lib/status";
import { createSignedUrlAction } from "@/server/commands/marketing";
import { daysUntil } from "@/features/marketing/lib/time";
import { formatDate, formatDateTime } from "@/lib/format";
import type { PermissionRecord } from "@/server/queries/marketing";
import { cn } from "@/lib/utils";

const CAPTURE_LABELS = Object.fromEntries(CAPTURE_TYPES.map((c) => [c.value, c.label]));
const USE_LABELS = Object.fromEntries(PERMITTED_USES.map((u) => [u.value, u.label]));

/** Expiry warning: inside 30 days is a nudge, past is a block. */
export function PermissionExpiry({ expiresAt, className }: { expiresAt: string | null | undefined; className?: string }) {
  const days = daysUntil(expiresAt);
  if (days === null) return null;
  if (days < 0) return <span className={cn("text-destructive", className)}>expired {formatDate(expiresAt)}</span>;
  if (days <= 30) return <span className={cn("text-warning", className)}>expires in {days} day{days === 1 ? "" : "s"}</span>;
  return <span className={cn("text-muted-foreground", className)}>expires {formatDate(expiresAt)}</span>;
}

export function PermissionSummary({ permission }: { permission: PermissionRecord | null }) {
  if (!permission) {
    return (
      <p className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
        <ShieldAlert className="size-4 shrink-0" aria-hidden /> No permission record yet.
      </p>
    );
  }
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <MarketingPill map={PERMISSION_STATUS} value={permission.status} size="md" />
        <PermissionExpiry expiresAt={permission.expires_at} className="text-xs" />
        {permission.granted_by_name && (
          <span className="text-xs text-muted-foreground">
            granted by {permission.granted_by_name}
            {permission.granted_at ? ` · ${formatDate(permission.granted_at)}` : ""}
          </span>
        )}
      </div>
      <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-[11px] text-muted-foreground">Permitted capture</dt>
          <dd>
            <Chips values={permission.permitted_capture} labels={CAPTURE_LABELS} />
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Permitted uses</dt>
          <dd>
            <Chips values={permission.permitted_uses} labels={USE_LABELS} />
          </dd>
        </div>
      </dl>
      {permission.restrictions && <p className="rounded-md border border-warning/25 bg-warning/5 px-2 py-1.5 text-xs text-warning">Restrictions: {permission.restrictions}</p>}
      {permission.revoked_at && (
        <p className="rounded-md border border-destructive/25 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
          Revoked {formatDateTime(permission.revoked_at)} — {permission.revocation_reason}
        </p>
      )}
    </div>
  );
}

export function PermissionEvidenceLink({ path }: { path: string | null }) {
  const [pending, setPending] = useState(false);
  if (!path) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="mt-1 h-7 px-2 text-xs"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const res = await createSignedUrlAction({ bucket: "permission-evidence", path });
        setPending(false);
        if (res.ok) window.open(res.data.url, "_blank", "noopener");
        else toast.error(res.error);
      }}
    >
      <Paperclip className="size-3" aria-hidden /> Open permission evidence
    </Button>
  );
}
