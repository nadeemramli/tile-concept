"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarCheck, ClipboardCheck, MapPin, Pencil, ShieldAlert, TriangleAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RecordDrawer, DrawerSection, FactList } from "@/components/patterns/record-drawer";
import { Gated, Hint, InfoTip } from "@/components/patterns/explain";
import { useSession } from "@/components/shell/session-context";
import { MarketingPill, Chips } from "@/features/marketing/components/pills";
import { BookingDialog } from "@/features/marketing/components/booking-dialog";
import { OutcomeDialog } from "@/features/marketing/components/outcome-dialog";
import { OutputDialog } from "@/features/marketing/components/output-dialog";
import { OutputsList } from "@/features/marketing/components/outputs-list";
import { PermissionExpiry } from "@/features/marketing/components/permission-summary";
import { BOOKING_STATUS, CLOSED_STATUSES, CONTENT_TYPES, CUSTOMER_MEDIA_PERMISSION_HINT, PARTICIPANT_ROLE_HINTS, PERMISSION_STATUS, READINESS_STATE, meta, permissionBlocks, permissionHint, permissionSentence } from "@/features/marketing/lib/status";
import { addChecklistItemAction, toggleChecklistAction } from "@/server/commands/marketing";
import { useAction } from "@/features/catalog/use-action";
import type { BookingDetail, SchedulableOpportunity } from "@/server/queries/marketing";
import type { ProfileRef } from "@/server/queries/reference";
import { formatDate, formatDateTime, titleCase } from "@/lib/format";
import { APP_TZ_LABEL, timeRangeLabel } from "@/features/marketing/lib/time";
import { cn } from "@/lib/utils";

const CONTENT_TYPE_LABELS = Object.fromEntries(CONTENT_TYPES.map((c) => [c.value, c.label]));
const CONTENT_TYPE_HINTS = Object.fromEntries(CONTENT_TYPES.map((c) => [c.value, c.hint]));

type Which = "edit" | "confirm" | "outcome" | "output" | null;

export function BookingDrawer({
  booking,
  members,
  opportunities,
  onClose,
}: {
  booking: BookingDetail;
  members: ProfileRef[];
  opportunities: SchedulableOpportunity[];
  onClose: () => void;
}) {
  const { can } = useSession();
  const [open, setOpen] = useState<Which>(null);
  const [newItem, setNewItem] = useState("");
  const names = new Map(members.map((m) => [m.user_id, m.full_name]));
  const toggle = useAction(toggleChecklistAction, { silent: true });
  const addItem = useAction(addChecklistItemAction, { onSuccess: () => setNewItem("") });

  const canWrite = can("marketing.write");
  const closed = CLOSED_STATUSES.has(booking.status);
  const blocked = permissionBlocks(booking.permission_status, booking.permission_expires_at);
  const notReady = booking.readiness_state !== "ready" && booking.readiness_state !== "completed";
  const doneCount = booking.checklists.filter((c) => c.is_done).length;

  return (
    <RecordDrawer
      open
      onOpenChange={(o) => !o && onClose()}
      width="xl"
      title={
        <span className="flex flex-wrap items-center gap-2">
          {booking.title ?? "Shoot"}
          <MarketingPill map={BOOKING_STATUS} value={booking.status} size="md" />
        </span>
      }
      description={
        <span className="flex flex-wrap gap-x-2">
          <span className="tnum">
            {formatDate(booking.starts_at)} · {timeRangeLabel(booking.starts_at, booking.ends_at)} {APP_TZ_LABEL}
          </span>
          {booking.content_opportunity_id && (
            <Link href={`/marketing/content-opportunities?opportunity=${booking.content_opportunity_id}&view=all`} className="hover:underline">
              · Nomination
            </Link>
          )}
          {booking.project_id && (
            <Link href={`/sales/projects/${booking.project_id}`} className="hover:underline">
              · {booking.project_name}
            </Link>
          )}
          {booking.contact_id && (
            <Link href={`/sales/contacts/${booking.contact_id}`} className="hover:underline">
              · {booking.contact_name}
            </Link>
          )}
        </span>
      }
      actions={
        !closed ? (
          <Gated permission="marketing.write">
            <Button size="sm" onClick={() => setOpen("edit")}>
              <Pencil className="size-3.5" aria-hidden /> Reschedule
            </Button>
          </Gated>
        ) : null
      }
    >
      {(blocked || notReady) && !closed && (
        <div className="space-y-1 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          {blocked && (
            <p className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                {permissionSentence(booking.permission_status, booking.permission_expires_at)} This is the customer&apos;s consent, not your access: the date can be held, but assets from this shoot cannot be marked usable until it is approved.
                {booking.content_opportunity_id && (
                  <>
                    {" "}
                    <Link href={`/marketing/content-opportunities?opportunity=${booking.content_opportunity_id}&view=all`} className="font-medium underline underline-offset-2">
                      Record it on the nomination
                    </Link>
                    .
                  </>
                )}
              </span>
            </p>
          )}
          {notReady && (
            <p className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                Project readiness is {meta(READINESS_STATE, booking.readiness_state).label.toLowerCase()}: {meta(READINESS_STATE, booking.readiness_state).hint} Confirm with the site before travelling.
              </span>
            </p>
          )}
        </div>
      )}

      {closed && booking.outcome && (
        <div className={cn("rounded-md border px-3 py-2 text-sm", booking.outcome === "completed" ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning")}>
          <span className="font-medium">{meta(BOOKING_STATUS, booking.outcome).label}</span>
          {booking.outcome_reason && <span className="block text-xs opacity-90">{booking.outcome_reason}</span>}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!closed && booking.status !== "confirmed" && (
          <Gated permission="marketing.confirm">
            <Button variant="outline" size="sm" onClick={() => setOpen("confirm")}>
              <CalendarCheck className="size-3.5" aria-hidden /> Confirm
            </Button>
          </Gated>
        )}
        {!closed && (
          <Gated permission="marketing.write">
            <Button variant="outline" size="sm" onClick={() => setOpen("outcome")}>
              <ClipboardCheck className="size-3.5" aria-hidden /> Record outcome
            </Button>
          </Gated>
        )}
        <Gated permission="marketing.write">
          <Button variant="outline" size="sm" onClick={() => setOpen("output")}>
            <Upload className="size-3.5" aria-hidden /> Add output
          </Button>
        </Gated>
      </div>

      <DrawerSection title="Facts" action={<InfoTip label="Facts" content="Coordinator, readiness and content types come from the nomination in Content Opportunities. Customer media permission is the customer's consent to be filmed and featured, recorded there too." />}>
        <FactList
          items={[
            { label: "Coordinator", value: names.get(booking.coordinator_id ?? "") ?? "—" },
            {
              label: "Customer media permission",
              value: (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <MarketingPill map={PERMISSION_STATUS} value={booking.permission_status ?? "not_requested"} hint={permissionHint(booking.permission_status, booking.permission_expires_at)} />
                  <PermissionExpiry expiresAt={booking.permission_expires_at} className="text-[11px]" />
                </span>
              ),
            },
            { label: "Readiness", value: <MarketingPill map={READINESS_STATE} value={booking.readiness_state} /> },
            { label: "Story angle", value: booking.story_angle ?? "—" },
            { label: "Content types", value: <Chips values={booking.content_types} labels={CONTENT_TYPE_LABELS} hints={CONTENT_TYPE_HINTS} /> },
            { label: "Timezone", value: `${booking.timezone} (${APP_TZ_LABEL})` },
          ]}
        />
        {booking.notes && <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-sm">{booking.notes}</p>}
      </DrawerSection>

      <DrawerSection title={`Participants (${booking.participants.length})`} action={<InfoTip label="Participants" content="Everyone attached to the shoot and their role. Crew and standby are checked for clashes with other bookings; the status shows whether they accepted." />}>
        {booking.participants.length === 0 ? (
          <p className="text-sm text-muted-foreground">No crew assigned.</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {booking.participants.map((p, i) => (
              <li key={`${p.user_id ?? p.name}-${i}`} className="flex items-center gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate">{p.name ?? names.get(p.user_id ?? "") ?? "External"}</span>
                <Hint content={PARTICIPANT_ROLE_HINTS[p.role as keyof typeof PARTICIPANT_ROLE_HINTS]} focusable>
                  <span className="text-xs text-muted-foreground">{titleCase(p.role)}</span>
                </Hint>
                <span className={cn("text-[11px]", p.status === "declined" ? "text-destructive" : p.status === "accepted" ? "text-success" : "text-muted-foreground")}>{titleCase(p.status)}</span>
              </li>
            ))}
          </ul>
        )}
      </DrawerSection>

      <DrawerSection title={`Sites (${booking.sites.length})`} action={<InfoTip label="Sites" content="The production-day order. The buffer is travel time reserved between this site and the next; it counts in the clash check." />}>
        {booking.sites.length === 0 ? (
          <p className="text-sm text-muted-foreground">No site attached.</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {booking.sites.map((s) => (
              <li key={s.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="tnum w-5 shrink-0 text-xs text-muted-foreground">{s.sequence}.</span>
                <MapPin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  {s.site_label ?? "Site"}
                  {s.address?.city ? <span className="ml-1 text-xs text-muted-foreground">{String(s.address.city)}</span> : null}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{s.travel_buffer_minutes} min buffer</span>
              </li>
            ))}
          </ul>
        )}
      </DrawerSection>

      <DrawerSection title={`Checklist (${doneCount}/${booking.checklists.length})`} action={<InfoTip label="Checklist" content="Pre-shoot checks for this booking: readiness, customer contact, equipment, interview questions, logistics. Ticking one records who and when." />}>
        <ul className="space-y-1">
          {booking.checklists.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-sm">
              <Gated permission="marketing.write">
                <Checkbox checked={c.is_done} disabled={toggle.pending} onCheckedChange={(v) => toggle.run({ id: c.id, is_done: !!v })} id={`c-${c.id}`} />
              </Gated>
              <label htmlFor={`c-${c.id}`} className={cn("flex-1", c.is_done && "text-muted-foreground line-through")}>
                {c.item}
              </label>
              {c.done_at && <span className="text-[11px] text-muted-foreground">{formatDate(c.done_at)}</span>}
            </li>
          ))}
        </ul>
        {canWrite && (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newItem.trim().length >= 2) addItem.run({ shoot_booking_id: booking.id, item: newItem.trim() });
            }}
          >
            <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add a pre-shoot check…" className="h-8 text-sm" />
            <Button type="submit" variant="outline" size="sm" className="h-8" disabled={addItem.pending || newItem.trim().length < 2}>
              Add
            </Button>
          </form>
        )}
      </DrawerSection>

      <DrawerSection title={`Outputs (${booking.outputs.length})`} action={<InfoTip label="Outputs" content={{ body: "Photos, video and notes from the shoot. Marking one usable is checked against the customer media permission by the database, so it cannot be done while that is unapproved or expired.", action: CUSTOMER_MEDIA_PERMISSION_HINT.action }} />}>
        <OutputsList outputs={booking.outputs} permissionStatus={booking.permission_status} permissionExpiresAt={booking.permission_expires_at} />
      </DrawerSection>

      <DrawerSection title={`Booking history (${booking.status_events.length})`} action={<InfoTip label="Booking history" content="Every status change with who made it and why. A reschedule keeps the previous slot here." />}>
        <ul className="space-y-1 text-sm">
          {booking.status_events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="tnum text-xs text-muted-foreground">{formatDateTime(e.occurred_at)}</span>
              <span>
                {e.from_status ? `${meta(BOOKING_STATUS, e.from_status).label} → ` : ""}
                <span className="font-medium">{meta(BOOKING_STATUS, e.to_status).label}</span>
              </span>
              {e.previous_starts_at && <span className="tnum text-xs text-muted-foreground">was {formatDateTime(e.previous_starts_at)}</span>}
              <span className="text-xs text-muted-foreground">{names.get(e.actor_id ?? "") ?? "system"}</span>
              {e.reason && <span className="text-xs italic text-muted-foreground">“{e.reason}”</span>}
            </li>
          ))}
        </ul>
      </DrawerSection>

      {(open === "edit" || open === "confirm") && (
        <BookingDialog
          open
          onOpenChange={(o) => !o && setOpen(null)}
          members={members}
          opportunities={opportunities}
          booking={open === "confirm" ? { ...booking, status: "confirmed" } : booking}
        />
      )}
      {open === "outcome" && <OutcomeDialog open onOpenChange={(o) => !o && setOpen(null)} bookingId={booking.id} />}
      {open === "output" && (
        <OutputDialog open onOpenChange={(o) => !o && setOpen(null)} contentOpportunityId={booking.content_opportunity_id} bookingId={booking.id} />
      )}
    </RecordDrawer>
  );
}
