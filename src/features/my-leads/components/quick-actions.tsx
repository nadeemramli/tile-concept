"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLocale } from "@/components/i18n/locale-context";
import { useSession } from "@/components/shell/session-context";
import { followUpDueAt } from "@/features/inbox/lib/follow-up";
import type { QuickUpdate } from "@/features/my-leads/lib/my-leads";
import type { MyLeadDetail } from "@/features/my-leads/types";
import { annotateInquiryAction, workInquiryAction } from "@/server/commands/inquiry";

const CHANNELS = ["whatsapp", "phone", "email", "dm", "meeting"] as const;
type Channel = (typeof CHANNELS)[number];

/** `datetime-local` value in Kuala Lumpur time (fixed UTC+8). */
function klInput(iso: string) {
  return new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString().slice(0, 16);
}

const NEEDS_DATE: ReadonlySet<QuickUpdate> = new Set(["schedule", "reschedule"]);
const NEEDS_REASON: ReadonlySet<QuickUpdate> = new Set(["complete", "no_next_action", "remark"]);
const NEEDS_CHANNEL: ReadonlySet<QuickUpdate> = new Set(["customer_replied", "contact_attempt", "no_response"]);

/**
 * One large next-action button and the other updates beneath it. Every save
 * goes through the Inquiry Inbox's own commands with a request ID that is
 * reused until the payload changes, so a double tap or an uncertain network
 * result never records the same update twice.
 */
export function QuickActions({ lead }: { lead: MyLeadDetail }) {
  const { t } = useLocale();
  const { can } = useSession();
  const m = t.myLeads;
  const router = useRouter();
  const [action, setAction] = useState<QuickUpdate | null>(null);
  const [body, setBody] = useState("");
  const [due, setDue] = useState("");
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const inFlight = useRef(false);
  const retry = useRef<{ payload: string; id: string } | null>(null);
  const disabled = !lead.canWrite || pending;

  function open(next: QuickUpdate) {
    setAction(next);
    setBody("");
    setError(null);
    setChannel(next === "contact_attempt" ? "phone" : "whatsapp");
    setDue(klInput(next === "reschedule" && lead.nextFollowUpAt ? lead.nextFollowUpAt : followUpDueAt(3)));
  }

  function submit() {
    if (!action || inFlight.current) return;
    const text = body.trim();
    if (NEEDS_REASON.has(action) && text.length < 3) { setError(m.needReason); return; }
    let dueIso: string | undefined;
    if (NEEDS_DATE.has(action)) {
      if (!due) { setError(m.needDate); return; }
      const date = new Date(`${due}:00+08:00`);
      if (!Number.isFinite(date.getTime())) { setError(m.badDate); return; }
      dueIso = date.toISOString();
    }
    const work = action === "remark" ? null : {
      lead_id: lead.id, action, body: text || undefined,
      channel: NEEDS_CHANNEL.has(action) ? channel : "whatsapp",
      task_id: action === "complete" || action === "reschedule" ? lead.nextFollowUpTaskId ?? undefined : undefined,
      due_at: dueIso,
    } satisfies Omit<Parameters<typeof workInquiryAction>[0], "request_id">;
    const payload = JSON.stringify(work ?? { lead_id: lead.id, action, body: text });
    if (retry.current?.payload !== payload) retry.current = { payload, id: crypto.randomUUID() };
    const request_id = retry.current.id;
    const saved = action;
    inFlight.current = true;
    start(async () => {
      try {
        const result = work
          ? await workInquiryAction({ ...work, request_id })
          : await annotateInquiryAction({ lead_id: lead.id, action: "remark", body: text, request_id });
        if (!result.ok) { setError(`${m.saveFailed} ${result.error}`); return; }
        retry.current = null;
        toast.success(m.saved[saved]);
        setAction(null);
        setError(null);
        router.refresh();
      } catch {
        setError(m.uncertain);
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <section aria-labelledby="my-lead-next" className="space-y-3">
      <h2 id="my-lead-next" className="text-sm font-semibold">{m.nextAction}</h2>
      {lead.primary ? (
        <Button size="lg" className="h-12 w-full text-base" disabled={disabled} onClick={() => open(lead.primary!)}>
          {m.actions[lead.primary]}
        </Button>
      ) : (
        <p className="rounded-md border p-3 text-sm text-muted-foreground">{m.closed}</p>
      )}
      {!lead.canWrite && <p className="text-sm text-muted-foreground">{can("sales.write") ? m.readOnly : m.readOnlyRole}</p>}
      <h3 className="pt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{m.moreActions}</h3>
      <div className="grid grid-cols-2 gap-2">
        {lead.secondary.map((key) => (
          <Button key={key} variant="outline" className="h-11 whitespace-normal text-sm leading-tight" disabled={disabled} onClick={() => open(key)}>
            {m.actions[key]}
          </Button>
        ))}
      </div>

      <Dialog open={action !== null} onOpenChange={(isOpen) => { if (!isOpen && !pending) setAction(null); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{action ? m.actions[action] : m.nextAction}</DialogTitle>
            <DialogDescription>{action ? m.explain[action] : ""}</DialogDescription>
          </DialogHeader>
          {action && NEEDS_CHANNEL.has(action) && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{m.channel}</legend>
              <div className="grid grid-cols-2 gap-2">
                {CHANNELS.map((c) => (
                  <Button key={c} type="button" variant={channel === c ? "default" : "outline"} aria-pressed={channel === c} className="h-11" onClick={() => setChannel(c)}>
                    {m.channels[c]}
                  </Button>
                ))}
              </div>
            </fieldset>
          )}
          {action && NEEDS_DATE.has(action) && (
            <div className="space-y-2">
              <Label htmlFor="my-lead-due">{m.dueAt}</Label>
              <Input id="my-lead-due" type="datetime-local" className="h-11 text-base" value={due} onChange={(event) => setDue(event.target.value)} />
              <div className="grid grid-cols-3 gap-2">
                {([[1, m.quickDue.tomorrow], [3, m.quickDue.three], [7, m.quickDue.week]] as const).map(([days, label]) => (
                  <Button key={days} type="button" variant="outline" className="h-11 whitespace-normal text-xs leading-tight" onClick={() => setDue(klInput(followUpDueAt(days)))}>
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {action && (
            <div className="space-y-2">
              <Label htmlFor="my-lead-body">{action === "remark" ? m.remarkLabel : NEEDS_REASON.has(action) ? m.reason : m.notes}</Label>
              <Textarea id="my-lead-body" className="min-h-24 text-base" value={body} onChange={(event) => setBody(event.target.value)} maxLength={4000} />
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="grid grid-cols-2 gap-2 sm:flex">
            <Button variant="outline" className="h-11" disabled={pending} onClick={() => setAction(null)}>{m.cancel}</Button>
            <Button className="h-11" disabled={pending} onClick={submit}>{pending ? m.saving : m.save}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
