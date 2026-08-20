"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarPlus, CheckCheck, CircleHelp, Pause, ShieldCheck, Upload, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RecordDrawer, DrawerSection, FactList } from "@/components/patterns/record-drawer";
import { StatusPill } from "@/components/patterns/status-pill";
import { Field } from "@/components/patterns/field";
import { FormDialog, formToObject } from "@/features/crm/components/form-dialog";
import { useSession } from "@/components/shell/session-context";
import { MarketingPill, Chips } from "@/features/marketing/components/pills";
import { PermissionDialog } from "@/features/marketing/components/permission-dialog";
import { BookingDialog } from "@/features/marketing/components/booking-dialog";
import { OutputDialog } from "@/features/marketing/components/output-dialog";
import { OutputsList } from "@/features/marketing/components/outputs-list";
import { PermissionEvidenceLink, PermissionSummary } from "@/features/marketing/components/permission-summary";
import { BOOKING_STATUS, CONTENT_STATUS, CONTENT_TYPES, PRIORITY, READINESS_OPTIONS, READINESS_STATE, meta } from "@/features/marketing/lib/status";
import { setContentStatusAction, setReadinessAction } from "@/server/commands/marketing";
import { useAction } from "@/features/catalog/use-action";
import type { ContentOpportunityDetail, SchedulableOpportunity } from "@/server/queries/marketing";
import type { ProfileRef } from "@/server/queries/reference";
import { formatDate, formatDateTime, titleCase } from "@/lib/format";
import { timeRangeLabel } from "@/features/marketing/lib/time";

const CONTENT_TYPE_LABELS = Object.fromEntries(CONTENT_TYPES.map((c) => [c.value, c.label]));

type Which = "permission" | "booking" | "output" | "decision" | null;

export function OpportunityDrawer({
  detail,
  members,
  opportunities,
  onClose,
}: {
  detail: ContentOpportunityDetail;
  members: ProfileRef[];
  opportunities: SchedulableOpportunity[];
  onClose: () => void;
}) {
  const { can } = useSession();
  const [open, setOpen] = useState<Which>(null);
  const [decision, setDecision] = useState<string>("accepted");
  const names = new Map(members.map((m) => [m.user_id, m.full_name]));
  const canWrite = can("marketing.write");
  const readiness = useAction(setReadinessAction);

  const decide = (status: string) => {
    setDecision(status);
    setOpen("decision");
  };
  const reasonRequired = ["declined", "deferred", "cancelled"].includes(decision);

  return (
    <RecordDrawer
      open
      onOpenChange={(o) => !o && onClose()}
      width="xl"
      title={
        <span className="flex flex-wrap items-center gap-2">
          {detail.project_name ?? "Content opportunity"}
          <MarketingPill map={CONTENT_STATUS} value={detail.status} size="md" />
        </span>
      }
      description={
        <span className="flex flex-wrap gap-x-2">
          {detail.contact_id && (
            <Link href={`/sales/contacts/${detail.contact_id}`} className="hover:underline">
              {detail.contact_name}
            </Link>
          )}
          {detail.account_id && (
            <Link href={`/sales/accounts/${detail.account_id}`} className="hover:underline">
              · {detail.account_name}
            </Link>
          )}
          {detail.project_id && (
            <Link href={`/sales/projects/${detail.project_id}`} className="hover:underline">
              · Project
            </Link>
          )}
        </span>
      }
      actions={
        canWrite ? (
          <Button size="sm" onClick={() => setOpen("booking")}>
            <CalendarPlus className="size-3.5" aria-hidden /> Schedule shoot
          </Button>
        ) : null
      }
    >
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => decide("accepted")}>
            <CheckCheck className="size-3.5" aria-hidden /> Accept
          </Button>
          <Button variant="outline" size="sm" onClick={() => decide("needs_info")}>
            <CircleHelp className="size-3.5" aria-hidden /> Needs info
          </Button>
          <Button variant="outline" size="sm" onClick={() => decide("deferred")}>
            <Pause className="size-3.5" aria-hidden /> Defer
          </Button>
          <Button variant="outline" size="sm" onClick={() => decide("declined")}>
            <XCircle className="size-3.5" aria-hidden /> Decline
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOpen("permission")}>
            <ShieldCheck className="size-3.5" aria-hidden /> Record permission
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOpen("output")}>
            <Upload className="size-3.5" aria-hidden /> Add asset
          </Button>
        </div>
      )}

      <DrawerSection title="Media permission">
        <PermissionSummary permission={detail.permission} />
        <PermissionEvidenceLink path={detail.permission?.evidence_storage_path ?? null} />
      </DrawerSection>

      <DrawerSection title="Facts">
        <FactList
          items={[
            { label: "Story angle", value: detail.story_angle ?? "—" },
            { label: "Priority", value: <StatusPill map={PRIORITY} value={detail.priority} /> },
            {
              label: "Readiness",
              value: canWrite ? (
                <Select
                  value={detail.readiness_state}
                  onValueChange={(v) => readiness.run({ id: detail.id, readiness_state: v })}
                  disabled={readiness.pending}
                >
                  <SelectTrigger className="h-7 w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {READINESS_OPTIONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {meta(READINESS_STATE, r).label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <MarketingPill map={READINESS_STATE} value={detail.readiness_state} />
              ),
            },
            { label: "Target window", value: detail.target_window_start ? `${formatDate(detail.target_window_start)} – ${formatDate(detail.target_window_end)}` : "—" },
            { label: "Content types", value: <Chips values={detail.content_types} labels={CONTENT_TYPE_LABELS} /> },
            { label: "Products used", value: <Chips values={detail.products_used} /> },
            { label: "Nominated by", value: names.get(detail.nominated_by ?? "") ?? "—" },
            { label: "Customer owner", value: names.get(detail.customer_owner_id ?? "") ?? "—" },
            { label: "Marketing owner", value: names.get(detail.marketing_owner_id ?? "") ?? "Unassigned" },
            { label: "Interview subjects", value: detail.interview_subjects ?? "—" },
            { label: "Nominated", value: formatDateTime(detail.created_at) },
          ]}
        />
        {detail.nomination_reason && (
          <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-sm">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Why this project</span>
            <br />
            {detail.nomination_reason}
          </p>
        )}
        {detail.site_notes && (
          <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-sm">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Site access</span>
            <br />
            {detail.site_notes}
          </p>
        )}
        {detail.special_requirements && (
          <p className="mt-2 whitespace-pre-wrap rounded-md border border-info/25 bg-info/5 p-2 text-sm">
            <span className="text-[11px] uppercase tracking-wider text-info">Special requirements</span>
            <br />
            {detail.special_requirements}
          </p>
        )}
      </DrawerSection>

      <DrawerSection title={`Bookings (${detail.bookings.length})`}>
        {detail.bookings.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">No shoot booked yet.</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {detail.bookings.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate">{b.title ?? "Shoot"}</span>
                <span className="tnum text-xs text-muted-foreground">
                  {formatDate(b.starts_at)} · {timeRangeLabel(b.starts_at, b.ends_at)}
                </span>
                <MarketingPill map={BOOKING_STATUS} value={b.status} />
                <Link href={`/marketing/shoot-calendar?booking=${b.id}`} className="text-xs text-info hover:underline">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </DrawerSection>

      <DrawerSection title={`Assets (${detail.outputs.length})`}>
        <OutputsList outputs={detail.outputs} permissionStatus={detail.permission?.status ?? null} permissionExpiresAt={detail.permission?.expires_at ?? null} />
      </DrawerSection>

      <DrawerSection title={`Status history (${detail.status_events.length})`}>
        <ul className="space-y-1 text-sm">
          {detail.status_events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="tnum text-xs text-muted-foreground">{formatDateTime(e.occurred_at)}</span>
              <span>
                {e.from_status ? `${meta(CONTENT_STATUS, e.from_status).label} → ` : ""}
                <span className="font-medium">{meta(CONTENT_STATUS, e.to_status).label}</span>
              </span>
              <span className="text-xs text-muted-foreground">{names.get(e.actor_id ?? "") ?? "system"}</span>
              {e.reason && <span className="text-xs italic text-muted-foreground">“{e.reason}”</span>}
            </li>
          ))}
        </ul>
      </DrawerSection>

      {open === "permission" && (
        <PermissionDialog open onOpenChange={(o) => !o && setOpen(null)} contentOpportunityId={detail.id} permission={detail.permission} />
      )}
      {open === "booking" && (
        <BookingDialog open onOpenChange={(o) => !o && setOpen(null)} members={members} opportunities={opportunities} fixedOpportunityId={detail.id} />
      )}
      {open === "output" && (
        <OutputDialog open onOpenChange={(o) => !o && setOpen(null)} contentOpportunityId={detail.id} bookingId={detail.bookings[0]?.id ?? null} />
      )}
      {open === "decision" && (
        <FormDialog
          open
          onOpenChange={(o) => !o && setOpen(null)}
          title={`Mark as ${meta(CONTENT_STATUS, decision).label.toLowerCase()}`}
          description={reasonRequired ? "A reason is required and is kept in the status history." : "Recorded in the status history."}
          submitLabel="Save"
          action={async (fd) => setContentStatusAction({ ...formToObject(fd), id: detail.id, status: decision })}
          onSuccess={() => setOpen(null)}
        >
          <Field label={reasonRequired ? "Reason" : "Note (optional)"} htmlFor="reason" required={reasonRequired}>
            <Textarea id="reason" name="reason" rows={2} required={reasonRequired} />
          </Field>
          {decision === "accepted" && (
            <Field label="Marketing owner" htmlFor="marketing_owner_id" hint="Defaults to you.">
              <select name="marketing_owner_id" defaultValue="" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm">
                <option value="">Me</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name} {m.role_key ? `· ${titleCase(m.role_key)}` : ""}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </FormDialog>
      )}
    </RecordDrawer>
  );
}
