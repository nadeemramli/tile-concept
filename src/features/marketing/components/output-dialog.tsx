"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/patterns/field";
import { FormDialog, formToObject } from "@/features/crm/components/form-dialog";
import { useSession } from "@/components/shell/session-context";
import { registerOutputAction } from "@/server/commands/marketing";
import { BUCKET_RULES, outputKindFor, uploadPrivateFile } from "@/features/marketing/lib/upload";
import { OUTPUT_KINDS } from "@/features/marketing/lib/status";
import { titleCase } from "@/lib/format";

/** Uploads to the private shoot-outputs bucket, then records the asset. */
export function OutputDialog({
  open,
  onOpenChange,
  contentOpportunityId,
  bookingId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contentOpportunityId: string;
  bookingId?: string | null;
}) {
  const { session } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<string>("photo");
  const [error, setError] = useState<string | null>(null);

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setFile(null);
          setError(null);
        }
        onOpenChange(o);
      }}
      title="Add shoot output"
      description="Assets land as uploaded and stay private until a reviewer marks them usable."
      submitLabel="Upload and record"
      action={async (fd) => {
        if (!file) return { ok: false as const, error: "Choose a file" };
        setError(null);
        try {
          const res = await uploadPrivateFile("shoot-outputs", session.workspaceId, contentOpportunityId, file);
          return registerOutputAction({
            ...formToObject(fd),
            content_opportunity_id: contentOpportunityId,
            shoot_booking_id: bookingId ?? undefined,
            kind,
            storage_path: res.path,
            mime_type: res.mimeType,
            size_bytes: res.size,
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Upload failed";
          setError(message);
          return { ok: false as const, error: message };
        }
      }}
    >
      <Field label="File" required hint={BUCKET_RULES["shoot-outputs"].label} error={error ?? undefined}>
        <Input
          type="file"
          accept={BUCKET_RULES["shoot-outputs"].accept}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            if (f?.type) setKind(outputKindFor(f.type));
          }}
        />
      </Field>
      <Field label="Kind">
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OUTPUT_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {titleCase(k)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Caption" htmlFor="caption">
        <Input id="caption" name="caption" placeholder="Completed feature wall, wide" />
      </Field>
      <Field label="Captured at" htmlFor="captured_at" hint="Defaults to now.">
        <Input id="captured_at" name="captured_at" type="datetime-local" />
      </Field>
    </FormDialog>
  );
}
