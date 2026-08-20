"use client";

import { useState } from "react";
import { Paperclip, ShieldAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/patterns/field";
import { FormDialog, formToObject } from "@/features/crm/components/form-dialog";
import { useSession } from "@/components/shell/session-context";
import { recordPermissionAction } from "@/server/commands/marketing";
import { CAPTURE_TYPES, PERMISSION_OPTIONS, PERMITTED_USES, meta, PERMISSION_STATUS } from "@/features/marketing/lib/status";
import { BUCKET_RULES, uploadPrivateFile } from "@/features/marketing/lib/upload";
import type { PermissionRecord } from "@/server/queries/marketing";
import { toLocalInput } from "@/features/marketing/lib/time";

/**
 * Media permission is recorded separately from ordinary contact consent
 * (PRD §7.11). The rules here mirror the database's so the operator sees what
 * is required before submitting, not after.
 */
export function PermissionDialog({
  open,
  onOpenChange,
  contentOpportunityId,
  permission,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contentOpportunityId: string;
  permission: PermissionRecord | null;
}) {
  const { session } = useSession();
  const [status, setStatus] = useState<string>(permission?.status ?? "requested");
  const [capture, setCapture] = useState<string[]>(permission?.permitted_capture ?? []);
  const [uses, setUses] = useState<string[]>(permission?.permitted_uses ?? []);
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const approving = status === "approved" || status === "approved_with_restrictions";
  const restricting = status === "approved_with_restrictions";
  const revoking = status === "revoked";

  const toggle = (list: string[], setList: (v: string[]) => void, value: string) =>
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setFile(null);
          setUploadError(null);
        }
        onOpenChange(o);
      }}
      title="Record media permission"
      description="What the customer has agreed to, who agreed, and any limits. Publishing an asset later checks this record."
      submitLabel="Save permission"
      className="sm:max-w-2xl"
      action={async (fd) => {
        setUploadError(null);
        let evidencePath = permission?.evidence_storage_path ?? undefined;
        if (file) {
          try {
            const res = await uploadPrivateFile("permission-evidence", session.workspaceId, contentOpportunityId, file);
            evidencePath = res.path;
          } catch (e) {
            const message = e instanceof Error ? e.message : "Upload failed";
            setUploadError(message);
            return { ok: false as const, error: message };
          }
        }
        const raw = formToObject(fd);
        return recordPermissionAction({
          ...raw,
          content_opportunity_id: contentOpportunityId,
          status,
          permitted_capture: capture,
          permitted_uses: uses,
          evidence_storage_path: evidencePath,
        });
      }}
    >
      <Field label="Permission state" required hint={meta(PERMISSION_STATUS, status).label}>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERMISSION_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {meta(PERMISSION_STATUS, s).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {approving && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Granted by" htmlFor="granted_by_name" required hint="The person who agreed, in their words.">
            <Input id="granted_by_name" name="granted_by_name" defaultValue={permission?.granted_by_name ?? ""} required />
          </Field>
          <Field label="Granted at" htmlFor="granted_at" hint="Defaults to now.">
            <Input id="granted_at" name="granted_at" type="datetime-local" defaultValue={toLocalInput(permission?.granted_at)} />
          </Field>
        </div>
      )}

      <Field label="Permitted capture" hint="What may be recorded on site.">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {CAPTURE_TYPES.map((c) => (
            <label key={c.value} className="flex items-center gap-2 text-sm">
              <Checkbox checked={capture.includes(c.value)} onCheckedChange={() => toggle(capture, setCapture, c.value)} />
              {c.label}
            </label>
          ))}
        </div>
      </Field>

      <Field
        label="Permitted uses"
        required={approving}
        error={approving && uses.length === 0 ? "Record at least one permitted use" : undefined}
        hint="Where the material may appear. An approval needs at least one."
      >
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {PERMITTED_USES.map((u) => (
            <label key={u.value} className="flex items-center gap-2 text-sm">
              <Checkbox checked={uses.includes(u.value)} onCheckedChange={() => toggle(uses, setUses, u.value)} />
              {u.label}
            </label>
          ))}
        </div>
      </Field>

      <Field
        label={restricting ? "Restrictions" : "Restrictions (optional)"}
        htmlFor="restrictions"
        required={restricting}
        hint="e.g. no exterior shots showing the house number."
      >
        <Textarea id="restrictions" name="restrictions" rows={2} required={restricting} defaultValue={permission?.restrictions ?? ""} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Expires" htmlFor="expires_at" hint="Leave empty if the permission does not expire.">
          <Input id="expires_at" name="expires_at" type="date" defaultValue={permission?.expires_at?.slice(0, 10) ?? ""} />
        </Field>
        <Field label="Evidence" hint={BUCKET_RULES["permission-evidence"].label} error={uploadError ?? undefined}>
          <Input type="file" accept={BUCKET_RULES["permission-evidence"].accept} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {permission?.evidence_storage_path && !file && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
              <Paperclip className="size-3" aria-hidden /> A file is already attached; choosing a new one replaces it.
            </p>
          )}
        </Field>
      </div>

      {revoking && (
        <Field label="Revocation reason" htmlFor="revocation_reason" required hint="Kept on the record; assets already marked usable return for review.">
          <Textarea id="revocation_reason" name="revocation_reason" rows={2} required />
        </Field>
      )}

      {(status === "declined" || revoking || status === "expired") && (
        <p className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Assets for this project will be flagged for permission review. Nothing is deleted — the evidence trail stays intact.
        </p>
      )}
    </FormDialog>
  );
}
