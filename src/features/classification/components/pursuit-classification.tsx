"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { DrawerSection, FactList } from "@/components/patterns/record-drawer";
import { StatusPill } from "@/components/patterns/status-pill";
import { DisabledHint, Hint } from "@/components/patterns/explain";
import { Field } from "@/components/patterns/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ARRIVAL_BASIS, CLASSIFICATION_BASIS, CLASSIFICATION_STATE } from "@/lib/domain/status-maps";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  CLASSIFICATION_DIMENSIONS,
  DIMENSION_HINT,
  DIMENSION_LABEL,
  REQUIRED_DIMENSIONS,
  changedKnownDimensions,
  classificationKey,
  missingDimensions,
  optionLabel,
  type ClassificationDimension,
  type ClassificationValues,
} from "@/features/classification/taxonomy";
import { ClassificationFields, DIM_ID } from "./classification-fields";
import { classifyPursuitAction, loadPursuitClassificationAction, setInquiryArrivalAction } from "@/server/commands/classification";
import type { PursuitClassification } from "@/server/queries/classification";

type Subject = { lead_id: string } | { opportunity_id: string };

/**
 * The classification of one pursuit in the inquiry or opportunity drawer:
 * current values and state, any held conflict, the history of changes and,
 * for an inquiry, its arrival. Reads its own data so the drawers' queries
 * stay unchanged; saving re-reads it, so what is shown is what was stored.
 */
export function PursuitClassificationSection({
  subject,
  canWrite,
  readOnlyReason,
  qualifyOpen = false,
  onQualifyOpenChange,
}: {
  subject: Subject;
  canWrite: boolean;
  readOnlyReason?: string;
  /** The inquiry drawer's "Qualify" action opens the dialog in qualification mode. */
  qualifyOpen?: boolean;
  onQualifyOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const subjectKey = "lead_id" in subject ? `lead:${subject.lead_id}` : `opp:${subject.opportunity_id}`;
  const [data, setData] = useState<PursuitClassification | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [arrivalOpen, setArrivalOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    const r = await loadPursuitClassificationAction("lead_id" in subject ? { lead_id: subject.lead_id } : { opportunity_id: subject.opportunity_id });
    if (r.ok) {
      setData(r.data);
      setFailed(false);
    } else setFailed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectKey]);

  useEffect(() => {
    let live = true;
    void loadPursuitClassificationAction("lead_id" in subject ? { lead_id: subject.lead_id } : { opportunity_id: subject.opportunity_id }).then((r) => {
      if (!live) return;
      if (r.ok) setData(r.data);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectKey]);

  const saved = () => {
    void load();
    router.refresh();
  };

  if (failed) return <DrawerSection title="Classification"><p className="text-sm text-destructive">Unable to load the classification. Close and reopen to retry.</p></DrawerSection>;
  if (!data) return <DrawerSection title="Classification"><p className="text-sm text-muted-foreground">Loading classification…</p></DrawerSection>;

  const editButton = (
    <Button size="sm" variant="outline" className="h-7" onClick={() => setEditing(true)} disabled={!canWrite}>
      <Pencil className="size-3.5" aria-hidden /> Classify
    </Button>
  );
  return (
    <DrawerSection title="Classification" action={canWrite ? editButton : <DisabledHint reason={readOnlyReason ?? "Your role cannot change this record."}>{editButton}</DisabledHint>}>
      <div className="flex flex-wrap items-center gap-2" data-testid="classification-state">
        <StatusPill map={CLASSIFICATION_STATE} value={data.state} />
        <StatusPill map={CLASSIFICATION_BASIS} value={data.basis} />
        {data.updated_at && <span className="text-[11px] text-muted-foreground">updated {formatDateTime(data.updated_at)}</span>}
      </div>
      <FactList
        className="sm:grid-cols-2"
        items={[...REQUIRED_DIMENSIONS, ...(data.values.glc_involvement === "yes" ? (["glc_party_role"] as const) : [])].map((d) => ({
          label: DIMENSION_LABEL[d],
          value: (
            <Hint content={DIMENSION_HINT[d]} focusable>
              <span data-testid={`classification-${DIM_ID[d]}`} className={data.values[d] === "unknown" ? "text-warning" : undefined}>
                {optionLabel(d, data.values[d])}
              </span>
            </Hint>
          ),
        }))}
      />
      {data.conflict && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm" role="status">
          {Object.entries(data.conflict).map(([d, c]) => (
            <p key={d}>
              A {c.source === "walk_in" ? "showroom visit" : (c.source ?? "later source")} recorded {DIMENSION_LABEL[d as ClassificationDimension]?.toLowerCase() ?? d} as{" "}
              <strong>{optionLabel(d as ClassificationDimension, c.proposed)}</strong>
              {c.source_value && c.source_value !== c.proposed ? ` (“${c.source_value}”)` : ""}; the record says <strong>{optionLabel(d as ClassificationDimension, c.recorded)}</strong>. Decide with Classify.
            </p>
          ))}
        </div>
      )}
      {data.state === "missing_flagged" && data.note && <p className="text-sm text-warning">Flagged as missing: {data.note}</p>}
      {data.arrival && <ArrivalLine arrival={data.arrival} canWrite={canWrite && "lead_id" in subject} onCorrect={() => setArrivalOpen(true)} />}
      <div>
        <button type="button" className="text-[11px] text-info hover:underline" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
          {showHistory ? "Hide classification history" : `Classification history (${data.history.length})`}
        </button>
        {showHistory && <ClassificationHistory items={data.history} />}
      </div>

      <ClassifyDialog
        key={`${subjectKey}:${data.version}:${editing || qualifyOpen}`}
        open={editing || qualifyOpen}
        onOpenChange={(o) => {
          if (!o) {
            setEditing(false);
            onQualifyOpenChange?.(false);
          }
        }}
        subject={subject}
        data={data}
        mode={qualifyOpen ? "qualification" : data.version === 0 && data.basis !== "legacy" ? "capture" : "correction"}
        onSaved={saved}
      />
      {"lead_id" in subject && data.arrival && (
        <ArrivalDialog key={`${subjectKey}:arrival:${arrivalOpen}`} open={arrivalOpen} onOpenChange={setArrivalOpen} leadId={subject.lead_id} arrival={data.arrival} onSaved={saved} />
      )}
    </DrawerSection>
  );
}

function ArrivalLine({ arrival, canWrite, onCorrect }: { arrival: NonNullable<PursuitClassification["arrival"]>; canWrite: boolean; onCorrect: () => void }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" data-testid="inquiry-arrival">
      <span>
        Arrived <span className="text-foreground">{arrival.precision === "date" ? formatDate(arrival.arrived_at) : formatDateTime(arrival.arrived_at)}</span>
      </span>
      <StatusPill map={ARRIVAL_BASIS} value={arrival.basis} />
      <span>{arrival.recorded_at ? `recorded ${formatDateTime(arrival.recorded_at)}` : "recording time not captured"}</span>
      {arrival.note && <span className="italic">“{arrival.note}”</span>}
      {canWrite && (
        <button type="button" className="text-info hover:underline" onClick={onCorrect}>
          Correct arrival
        </button>
      )}
    </p>
  );
}

function ClassificationHistory({ items }: { items: PursuitClassification["history"] }) {
  if (items.length === 0) return <p className="mt-1 text-sm text-muted-foreground">No classification recorded yet.</p>;
  return (
    <ol className="mt-2 space-y-2 text-sm" data-testid="classification-history">
      {items.map((e) => {
        const changes = CLASSIFICATION_DIMENSIONS.filter((d) => (e.before?.[d] ?? null) !== (e.after[d] ?? null) && (e.before !== null || (e.after[d] ?? "unknown") !== "unknown"));
        return (
          <li key={e.id} className="rounded-md border px-2.5 py-1.5">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span className="tnum">{formatDateTime(e.occurred_at)}</span>
              <StatusPill map={CLASSIFICATION_BASIS} value={e.basis} />
              <span>{e.actor_name ?? "system"}</span>
            </div>
            {changes.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {changes.map((d) => (
                  <li key={d}>
                    {DIMENSION_LABEL[d]}: {optionLabel(d, e.before?.[d] ?? "unknown")} → <span className="font-medium">{optionLabel(d, e.after[d] ?? null)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1">State: {CLASSIFICATION_STATE[String(e.after.classification_state ?? "")]?.label ?? "—"}</p>
            )}
            {e.reason && <p className="mt-0.5 text-xs italic text-muted-foreground">“{e.reason}”</p>}
          </li>
        );
      })}
    </ol>
  );
}

function ClassifyDialog({
  open,
  onOpenChange,
  subject,
  data,
  mode,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  subject: Subject;
  data: PursuitClassification;
  mode: "capture" | "qualification" | "correction";
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [value, setValue] = useState<ClassificationValues>(data.values);
  const [reason, setReason] = useState("");
  const [flag, setFlag] = useState(false);
  const request = useRef<string | null>(null);
  const missing = missingDimensions(value);
  const changedKnown = changedKnownDimensions(data.values, value);
  const needsReason = changedKnown.length > 0 || !!data.conflict;
  const suggestion = data.values.buyer_role === "unknown" ? classificationKey("buyer_role", data.contact_customer_type) : null;
  const blocker =
    needsReason && reason.trim().length < 5
      ? data.conflict
        ? "Say how the conflicting classification was resolved (at least 5 characters)."
        : `Explain why the ${changedKnown.map((d) => DIMENSION_LABEL[d].toLowerCase()).join(", ")} changed (at least 5 characters).`
      : flag && missing.length > 0 && reason.trim().length < 3
        ? "Say what is missing and why (at least 3 characters)."
        : mode === "qualification" && missing.length > 0 && !flag
          ? `Classify the ${missing.map((d) => DIMENSION_LABEL[d].toLowerCase()).join(", ")} or flag ${missing.length === 1 ? "it" : "them"} as missing.`
          : null;
  const submit = () =>
    start(async () => {
      request.current ??= crypto.randomUUID();
      const r = await classifyPursuitAction({
        request_id: request.current,
        ...("lead_id" in subject ? { lead_id: subject.lead_id } : { opportunity_id: subject.opportunity_id }),
        mode,
        expected_version: data.version,
        reason: reason.trim() || undefined,
        flag_missing: flag && missing.length > 0,
        values: value,
      });
      if (!r.ok) {
        toast.error(r.error);
        // A refused save may be retried with different values: a fresh request.
        request.current = null;
        return;
      }
      toast.success(r.message);
      request.current = null;
      onOpenChange(false);
      onSaved();
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "qualification" ? "Qualify inquiry" : "Classify pursuit"}</DialogTitle>
          <DialogDescription>
            {mode === "qualification"
              ? "Qualifying states who is buying and what for. Choose Unknown for anything not yet known and flag it, so it is followed up rather than guessed."
              : "Applies to this pursuit only: the inquiry and its opportunity stay in step, and other pursuits by the same person keep their own classification."}
          </DialogDescription>
        </DialogHeader>
        <ClassificationFields value={value} onChange={setValue} idPrefix="classify" current={data.values} />
        {suggestion && suggestion !== value.buyer_role && (
          <p className="text-xs text-muted-foreground">
            The customer record says {optionLabel("buyer_role", suggestion).toLowerCase()}.{" "}
            <button type="button" className="text-info hover:underline" onClick={() => setValue({ ...value, buyer_role: suggestion })}>
              Use it for this pursuit
            </button>
          </p>
        )}
        {missing.length > 0 && (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={flag} onCheckedChange={(v) => setFlag(!!v)} aria-label="Flag the missing classification for review" className="mt-0.5" />
            <span>
              Flag as missing: {missing.map((d) => DIMENSION_LABEL[d]).join(", ")}
              <span className="block text-[11px] text-muted-foreground">It stays in Classification Review until filled.</span>
            </span>
          </label>
        )}
        <Field
          label={needsReason ? "Reason for the change" : flag ? "What is missing and why" : "Note (optional)"}
          htmlFor="classify-reason"
          required={needsReason || (flag && missing.length > 0)}
          hint="Kept in the classification history."
        >
          <Textarea id="classify-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <DisabledHint reason={blocker}>
            <Button onClick={submit} disabled={pending || !!blocker}>
              {pending ? "Saving…" : mode === "qualification" ? "Qualify" : "Save classification"}
            </Button>
          </DisabledHint>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** KL wall-clock string for a datetime-local input. */
function klLocal(iso: string) {
  const d = new Date(new Date(iso).getTime() + 8 * 3_600_000);
  return d.toISOString().slice(0, 16);
}

function ArrivalDialog({ open, onOpenChange, leadId, arrival, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; leadId: string; arrival: NonNullable<PursuitClassification["arrival"]>; onSaved: () => void }) {
  const [pending, start] = useTransition();
  const [at, setAt] = useState(klLocal(arrival.arrived_at));
  const [precision, setPrecision] = useState<"exact" | "date">(arrival.precision === "date" ? "date" : "exact");
  const [basis, setBasis] = useState<"backdated" | "import" | "tracker">(arrival.basis === "import" || arrival.basis === "tracker" ? arrival.basis : "backdated");
  const [reason, setReason] = useState("");
  const request = useRef<string | null>(null);
  const iso = precision === "date" ? `${at.slice(0, 10)}T00:00:00+08:00` : `${at}:00+08:00`;
  const blocker = !at ? "Enter when the customer got in touch." : reason.trim().length < 5 ? "Explain where the arrival time comes from (at least 5 characters)." : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Correct arrival</DialogTitle>
          <DialogDescription>When the customer actually got in touch. It cannot be later than a response, reply or visit already recorded, and the previous value stays in the history.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Arrived (Malaysia time)" htmlFor="arrival-at" required>
            <Input id="arrival-at" type={precision === "date" ? "date" : "datetime-local"} className="h-8" value={precision === "date" ? at.slice(0, 10) : at} onChange={(e) => setAt(precision === "date" ? `${e.target.value}T00:00` : e.target.value)} />
          </Field>
          <Field label="Precision" htmlFor="arrival-precision">
            <Select value={precision} onValueChange={(v) => setPrecision(v as "exact" | "date")}>
              <SelectTrigger id="arrival-precision" className="h-8 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="exact">Exact time</SelectItem>
                <SelectItem value="date">Date only</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="How it is known" htmlFor="arrival-basis" tip="Backdated: entered later from the conversation. Import or Daily Tracker: the source file gave the time.">
          <Select value={basis} onValueChange={(v) => setBasis(v as typeof basis)}>
            <SelectTrigger id="arrival-basis" className="h-8 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="backdated">Backdated</SelectItem>
              <SelectItem value="import">Imported</SelectItem>
              <SelectItem value="tracker">Daily Tracker</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Where the time comes from" htmlFor="arrival-reason" required>
          <Textarea id="arrival-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
        </Field>
        <DialogFooter>
          <DisabledHint reason={blocker}>
            <Button
              disabled={pending || !!blocker}
              onClick={() =>
                start(async () => {
                  request.current ??= crypto.randomUUID();
                  const r = await setInquiryArrivalAction({ request_id: request.current, lead_id: leadId, arrived_at: new Date(iso).toISOString(), basis, precision, reason: reason.trim() });
                  request.current = null;
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(r.message);
                  onOpenChange(false);
                  onSaved();
                })
              }
            >
              {pending ? "Saving…" : "Save arrival"}
            </Button>
          </DisabledHint>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
