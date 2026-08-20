"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, FileVideo, Image as ImageIcon, NotepadText, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/patterns/field";
import { FormDialog, formToObject } from "@/features/crm/components/form-dialog";
import { useSession } from "@/components/shell/session-context";
import { MarketingPill } from "@/features/marketing/components/pills";
import { OUTPUT_STATE, permissionBlocks } from "@/features/marketing/lib/status";
import { createSignedUrlAction, reviewOutputAction } from "@/server/commands/marketing";
import type { OutputRow } from "@/server/queries/marketing";
import { formatDateTime } from "@/lib/format";
import { useAction } from "@/features/catalog/use-action";

const KIND_ICON = { photo: ImageIcon, video: FileVideo, interview_notes: NotepadText, other: Paperclip } as const;

function bytes(n: number | null) {
  if (!n) return "";
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

/** Opens a short-lived signed link — the bucket is private. */
function DownloadButton({ path }: { path: string | null }) {
  const [pending, setPending] = useState(false);
  if (!path) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-1.5 text-xs"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const res = await createSignedUrlAction({ bucket: "shoot-outputs", path });
        setPending(false);
        if (res.ok) window.open(res.data.url, "_blank", "noopener");
        else toast.error(res.error);
      }}
    >
      <Download className="size-3" aria-hidden /> Open
    </Button>
  );
}

export function OutputsList({
  outputs,
  permissionStatus,
  permissionExpiresAt,
}: {
  outputs: OutputRow[];
  permissionStatus: string | null;
  permissionExpiresAt: string | null;
}) {
  const { can } = useSession();
  const [reviewing, setReviewing] = useState<{ output: OutputRow; decision: "usable" | "restricted" | "rejected" } | null>(null);
  const quickReview = useAction(reviewOutputAction);
  const canReview = can("marketing.confirm");
  const blocked = permissionBlocks(permissionStatus, permissionExpiresAt);

  if (outputs.length === 0) return <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">No assets yet.</p>;

  return (
    <>
      <ul className="divide-y rounded-md border">
        {outputs.map((o) => {
          const Icon = KIND_ICON[o.kind as keyof typeof KIND_ICON] ?? Paperclip;
          const lastReview = o.reviews[0];
          return (
            <li key={o.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{o.caption ?? o.storage_path?.split("/").pop() ?? "Asset"}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {formatDateTime(o.captured_at)} {bytes(o.size_bytes)}
                  {lastReview?.reason ? ` · “${lastReview.reason}”` : ""}
                </span>
              </span>
              <MarketingPill map={OUTPUT_STATE} value={o.state} />
              <DownloadButton path={o.storage_path} />
              {canReview && o.state !== "usable" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={quickReview.pending}
                  onClick={async () => {
                    const res = await quickReview.run({ output_id: o.id, decision: "usable" });
                    // The database gates "usable" on an approved, unexpired permission.
                    if (!res.ok) setReviewing(null);
                  }}
                >
                  Mark usable
                </Button>
              )}
              {canReview && (
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setReviewing({ output: o, decision: "restricted" })}>
                  Review…
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {canReview && blocked && (
        <p className="mt-2 text-[11px] text-warning">
          Customer media permission is not approved (or has lapsed), so nothing here can be marked usable yet.
        </p>
      )}

      {reviewing && (
        <FormDialog
          open
          onOpenChange={(o) => !o && setReviewing(null)}
          title="Review asset"
          description="Restricted keeps the asset on file but out of use. Rejected takes it out of consideration."
          submitLabel="Save decision"
          action={async (fd) => {
            const raw = formToObject(fd) as { decision?: string; reason?: string };
            return reviewOutputAction({ output_id: reviewing.output.id, decision: raw.decision ?? "restricted", reason: raw.reason });
          }}
          onSuccess={() => setReviewing(null)}
        >
          <Field label="Decision" required>
            <select name="decision" defaultValue="restricted" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm">
              <option value="usable">Usable under the recorded permission</option>
              <option value="restricted">Restricted</option>
              <option value="rejected">Rejected</option>
            </select>
          </Field>
          <Field label="Reason" htmlFor="reason" hint="Kept with the asset's review history.">
            <Textarea id="reason" name="reason" rows={2} />
          </Field>
        </FormDialog>
      )}
    </>
  );
}
