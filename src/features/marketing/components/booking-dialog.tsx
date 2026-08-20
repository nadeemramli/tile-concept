"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { CalendarClock, Loader2, ShieldAlert, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/patterns/field";
import { FormDialog, formToObject } from "@/features/crm/components/form-dialog";
import { useSession } from "@/components/shell/session-context";
import { checkConflictsAction, listProjectSitesAction, upsertBookingAction, type ShootConflict, type SiteOption } from "@/server/commands/marketing";
import { PARTICIPANT_ROLES, PERMISSION_APPROVED, PERMISSION_STATUS, READINESS_STATE, SCHEDULABLE_STATUSES, meta, BOOKING_STATUS } from "@/features/marketing/lib/status";
import { APP_TZ_LABEL, fromLocalInput, toLocalInput } from "@/features/marketing/lib/time";
import type { BookingDetail, SchedulableOpportunity } from "@/server/queries/marketing";
import type { ProfileRef } from "@/server/queries/reference";
import { titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Assignment {
  user_id: string;
  role: string;
}

/** Two hours from now, rounded to the hour, as a datetime-local value. */
function defaultStart() {
  const d = new Date(Date.now() + 2 * 3600_000);
  d.setMinutes(0, 0, 0);
  return toLocalInput(d.toISOString());
}

function addHours(local: string, hours: number) {
  const iso = fromLocalInput(local);
  if (!iso) return "";
  return toLocalInput(new Date(new Date(iso).getTime() + hours * 3600_000).toISOString());
}

export function BookingDialog({
  open,
  onOpenChange,
  members,
  opportunities,
  booking,
  fixedOpportunityId,
  defaultDay,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  members: ProfileRef[];
  opportunities: SchedulableOpportunity[];
  /** Present when editing or rescheduling an existing booking. */
  booking?: BookingDetail | null;
  /** Present when scheduling from a nomination drawer. */
  fixedOpportunityId?: string;
  defaultDay?: string;
}) {
  const { can, session } = useSession();
  const editing = !!booking;

  const [opportunityId, setOpportunityId] = useState<string>(booking?.content_opportunity_id ?? fixedOpportunityId ?? "");
  const [start, setStart] = useState<string>(booking ? toLocalInput(booking.starts_at) : defaultDay ? `${defaultDay}T10:00` : defaultStart());
  const [end, setEnd] = useState<string>(booking ? toLocalInput(booking.ends_at) : defaultDay ? `${defaultDay}T13:00` : addHours(defaultStart(), 3));
  const [status, setStatus] = useState<string>(booking?.status && (SCHEDULABLE_STATUSES as readonly string[]).includes(booking.status) ? booking.status : "tentative");
  const [assignments, setAssignments] = useState<Assignment[]>(
    booking?.participants.filter((p) => p.user_id).map((p) => ({ user_id: p.user_id as string, role: p.role })) ?? [{ user_id: session.userId, role: "coordinator" }],
  );
  const [siteIds, setSiteIds] = useState<string[]>(booking?.sites.map((s) => s.project_site_id ?? "").filter(Boolean) ?? []);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [conflicts, setConflicts] = useState<ShootConflict[]>([]);
  const [override, setOverride] = useState(false);
  const [checking, startCheck] = useTransition();

  const opportunity = opportunities.find((o) => o.id === opportunityId);
  const projectId = booking?.project_id ?? opportunity?.project_id ?? null;
  const canConfirm = can("marketing.confirm");
  const permissionStatus = booking?.permission_status ?? opportunity?.permission_status ?? null;
  const permissionOk = permissionStatus ? PERMISSION_APPROVED.has(permissionStatus) : false;
  const readiness = booking?.readiness_state ?? opportunity?.readiness_state ?? null;

  const participantIds = useMemo(() => assignments.map((a) => a.user_id).filter(Boolean), [assignments]);
  const blocking = conflicts.filter((c) => c.severity === "blocking");
  const warnings = conflicts.filter((c) => c.severity !== "blocking");
  const needsOverride = status === "confirmed" && blocking.length > 0;

  // Site list follows the project behind the chosen nomination.
  useEffect(() => {
    if (!open) return;
    let live = true;
    (async () => {
      if (!projectId) {
        if (live) setSites([]);
        return;
      }
      const res = await listProjectSitesAction(projectId);
      if (live && res.ok) setSites(res.data);
    })();
    return () => {
      live = false;
    };
  }, [projectId, open]);

  // Live conflict preview as the time or the crew changes.
  useEffect(() => {
    if (!open) return;
    const startsAt = fromLocalInput(start);
    const endsAt = fromLocalInput(end);
    const t = setTimeout(() => {
      if (!startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) {
        setConflicts([]);
        return;
      }
      startCheck(async () => {
        const res = await checkConflictsAction({ starts_at: startsAt, ends_at: endsAt, participant_ids: participantIds, booking_id: booking?.id });
        setConflicts(res.ok ? res.data : []);
      });
    }, 300);
    return () => clearTimeout(t);
  }, [start, end, participantIds, booking?.id, open]);

  const toggleMember = (userId: string) =>
    setAssignments((prev) => (prev.some((a) => a.user_id === userId) ? prev.filter((a) => a.user_id !== userId) : [...prev, { user_id: userId, role: "crew" }]));

  const setRole = (userId: string, role: string) => setAssignments((prev) => prev.map((a) => (a.user_id === userId ? { ...a, role } : a)));

  const statusOptions = SCHEDULABLE_STATUSES.filter((s) => s !== "confirmed" || canConfirm);

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setConflicts([]);
          setOverride(false);
        }
        onOpenChange(o);
      }}
      title={editing ? "Reschedule or edit booking" : "New shoot booking"}
      description={`Times are ${APP_TZ_LABEL}. Rescheduling keeps the previous slot in the booking history.`}
      submitLabel={editing ? "Save booking" : status === "confirmed" ? "Create and confirm" : "Create hold"}
      className="sm:max-w-2xl"
      action={async (fd) =>
        upsertBookingAction({
          ...formToObject(fd),
          booking_id: booking?.id,
          content_opportunity_id: opportunityId,
          starts_at: fromLocalInput(start) ?? "",
          ends_at: fromLocalInput(end) ?? "",
          status,
          participants: assignments.map((a) => ({ user_id: a.user_id, role: a.role, status: a.role === "standby" ? "standby" : "assigned" })),
          sites: siteIds.map((id, i) => ({ project_site_id: id, sequence: i + 1, travel_buffer_minutes: 45 })),
          override,
        })
      }
    >
      {!editing && !fixedOpportunityId && (
        <Field label="Content opportunity" required hint="Only nominated or accepted customer projects can be booked.">
          <Select value={opportunityId} onValueChange={setOpportunityId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a nomination…" />
            </SelectTrigger>
            <SelectContent>
              {opportunities.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                  {o.contact_name ? ` · ${o.contact_name}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      {opportunityId && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
          <span className="text-muted-foreground">Permission</span>
          <span className={cn(permissionOk ? "text-success" : "text-warning")}>{meta(PERMISSION_STATUS, permissionStatus ?? "not_requested").label}</span>
          <span className="text-muted-foreground">· Readiness</span>
          <span>{meta(READINESS_STATE, readiness ?? "in_progress").label}</span>
        </div>
      )}

      <Field label="Title" htmlFor="title" hint="What the crew will see on the calendar.">
        <Input id="title" name="title" defaultValue={booking?.title ?? ""} placeholder="Feature wall shoot" />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Starts (${APP_TZ_LABEL})`} htmlFor="starts_at" required>
          <Input
            id="starts_at"
            type="datetime-local"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              if (!end || end <= e.target.value) setEnd(addHours(e.target.value, 3));
            }}
            required
          />
        </Field>
        <Field label="Ends" htmlFor="ends_at" required error={end && start && end <= start ? "The end time must be after the start time" : undefined}>
          <Input id="ends_at" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </Field>
      </div>

      <Field label="Status" hint={meta(BOOKING_STATUS, status).hint ?? undefined}>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((s) => (
              <SelectItem key={s} value={s}>
                {meta(BOOKING_STATUS, s).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!canConfirm && <p className="mt-1 text-[11px] text-muted-foreground">Confirming crew capacity needs the marketing coordinator role.</p>}
      </Field>

      <Field label="Crew and participants" hint="Standby assignments are held in reserve and still checked for clashes.">
        <ul className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-1">
          {members.map((m) => {
            const assignment = assignments.find((a) => a.user_id === m.user_id);
            return (
              <li key={m.user_id} className="flex items-center gap-2 rounded px-1.5 py-1">
                <Checkbox checked={!!assignment} onCheckedChange={() => toggleMember(m.user_id)} id={`p-${m.user_id}`} />
                <label htmlFor={`p-${m.user_id}`} className="min-w-0 flex-1 truncate text-sm">
                  {m.full_name}
                  <span className="ml-1 text-[11px] text-muted-foreground">{m.role_key ? titleCase(m.role_key) : ""}</span>
                </label>
                {assignment && (
                  <Select value={assignment.role} onValueChange={(r) => setRole(m.user_id, r)}>
                    <SelectTrigger className="h-7 w-36 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PARTICIPANT_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {titleCase(r)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </li>
            );
          })}
        </ul>
      </Field>

      {sites.length > 0 && (
        <Field label="Sites" hint="Ordered as a production day; each leg carries a 45-minute travel buffer.">
          <div className="space-y-1">
            {sites.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={siteIds.includes(s.id)} onCheckedChange={() => setSiteIds((prev) => (prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]))} />
                {s.label}
              </label>
            ))}
          </div>
        </Field>
      )}

      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={2} defaultValue={booking?.notes ?? ""} placeholder="Bring the wide lens and the tripod." />
      </Field>

      {/* Conflicts are shown as data, before anything is committed. */}
      <div className="rounded-md border">
        <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs font-medium">
          <CalendarClock className="size-3.5 text-muted-foreground" aria-hidden />
          Conflict check
          {checking && <Loader2 className="size-3 animate-spin text-muted-foreground" aria-hidden />}
          {!checking && conflicts.length === 0 && <span className="ml-auto text-success">No clashes found</span>}
          {!checking && conflicts.length > 0 && <span className="ml-auto text-warning">{conflicts.length} to consider</span>}
        </div>
        {conflicts.length > 0 && (
          <ul className="divide-y text-xs">
            {[...blocking, ...warnings].map((c, i) => (
              <li key={`${c.kind}-${c.booking_id}-${i}`} className="flex items-start gap-2 px-3 py-1.5">
                <TriangleAlert className={cn("mt-0.5 size-3.5 shrink-0", c.severity === "blocking" ? "text-destructive" : "text-warning")} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className={cn("font-medium", c.severity === "blocking" ? "text-destructive" : "text-warning")}>{titleCase(c.kind)}</span> — {c.detail}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {needsOverride && (
        <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="flex items-start gap-2 text-xs text-destructive">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            A confirmed booking already has one of these people. Confirming anyway needs an audited override.
          </p>
          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={override} onCheckedChange={(v) => setOverride(!!v)} />
            Override the clash and record why
          </label>
        </div>
      )}

      <Field
        label={needsOverride || editing ? "Reason" : "Reason (optional)"}
        htmlFor="reason"
        required={needsOverride && override}
        hint={editing ? "Recorded in the booking history alongside the previous slot." : undefined}
      >
        <Textarea id="reason" name="reason" rows={2} required={needsOverride && override} />
      </Field>

      {!permissionOk && opportunityId && (
        <p className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Customer media permission is not approved yet. You can still hold a date — assets cannot be marked usable until it is.
        </p>
      )}
    </FormDialog>
  );
}
