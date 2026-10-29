import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { getMemberMap } from "@/server/queries/reference";
import type { QuoteAnchor, QuoteContext, QuoteEventView, QuoteSendView, QuoteVersionView, QuoteView, VisitEvidenceView } from "@/features/quotes/types";

const num = (v: number | string | null | undefined) => (v === null || v === undefined ? null : Number(v));

/**
 * Every quote that belongs to the pursuit the panel is opened from: an inquiry
 * also shows quotes on the opportunity it became, a visit shows its inquiry's
 * quotes, and an opportunity shows its inquiry's. Visit evidence is listed for
 * a visit and for every visit of an inquiry.
 */
export async function getQuoteContext(anchor: QuoteAnchor): Promise<QuoteContext> {
  const db = await createServerSupabase();
  const filters: string[] = [];
  let visitIds: string[] = [];
  if ("lead_id" in anchor) {
    const [{ data: lead }, { data: visits }] = await Promise.all([
      db.from("leads").select("converted_opportunity_id").eq("id", anchor.lead_id).maybeSingle(),
      db.from("visits").select("id").eq("lead_id", anchor.lead_id),
    ]);
    filters.push(`lead_id.eq.${anchor.lead_id}`);
    if (lead?.converted_opportunity_id) filters.push(`opportunity_id.eq.${lead.converted_opportunity_id}`);
    visitIds = (visits ?? []).flatMap((v) => (v.id ? [v.id] : []));
  } else if ("visit_id" in anchor) {
    const { data: visit } = await db.from("visits").select("lead_id").eq("id", anchor.visit_id).maybeSingle();
    filters.push(`visit_id.eq.${anchor.visit_id}`);
    if (visit?.lead_id) filters.push(`lead_id.eq.${visit.lead_id}`);
    visitIds = [anchor.visit_id];
  } else {
    const { data: opp } = await db.from("opportunities").select("lead_id").eq("id", anchor.opportunity_id).maybeSingle();
    filters.push(`opportunity_id.eq.${anchor.opportunity_id}`);
    if (opp?.lead_id) filters.push(`lead_id.eq.${opp.lead_id}`);
  }

  const [{ data: register, error }, { data: evidenceRows }] = await Promise.all([
    db.from("quote_register").select("*").or(filters.join(",")).order("created_at", { ascending: false }).limit(100),
    visitIds.length ? db.from("visit_quote_evidence").select("*").in("visit_id", visitIds).order("visit_occurred_at", { ascending: false }) : Promise.resolve({ data: [] }),
  ]);
  if (error) throw new Error(error.message);
  const quoteIds = (register ?? []).flatMap((q) => (q.quote_id ? [q.quote_id] : []));

  const [{ data: versions }, { data: deliveries }, { data: facts }, { data: events }, members] = await Promise.all([
    quoteIds.length ? db.from("quote_versions").select("id, quote_id, version_no, prepared_at, issued_at, total_amount, currency, external_ref, valid_until, evidence_state, notes").in("quote_id", quoteIds) : Promise.resolve({ data: [] }),
    quoteIds.length ? db.from("quote_deliveries").select("id, quote_version_id, sent_at, recorded_at, channel, evidence, evidence_ref, note, sent_by, recorded_by").in("quote_id", quoteIds) : Promise.resolve({ data: [] }),
    quoteIds.length ? db.from("quote_send_facts").select("delivery_id, send_kind").in("quote_id", quoteIds) : Promise.resolve({ data: [] }),
    quoteIds.length ? db.from("quote_events").select("id, quote_id, event_type, occurred_at, recorded_at, actor_id, reason").in("quote_id", quoteIds).order("recorded_at", { ascending: false }) : Promise.resolve({ data: [] }),
    getMemberMap(),
  ]);
  const sentIds = (deliveries ?? []).flatMap((d) => (d.id ? [d.id] : []));
  const { data: voids } = sentIds.length ? await db.from("quote_delivery_voids").select("delivery_id, reason, voided_at").in("delivery_id", sentIds) : { data: [] };
  const name = (id: string | null | undefined) => (id ? (members.get(id)?.full_name ?? null) : null);
  const kindByDelivery = new Map((facts ?? []).map((f) => [f.delivery_id, f.send_kind]));
  const voidByDelivery = new Map((voids ?? []).map((v) => [v.delivery_id, v]));

  const sendsByVersion = new Map<string, QuoteSendView[]>();
  for (const d of deliveries ?? []) {
    if (!d.id || !d.quote_version_id || !d.sent_at || !d.recorded_at || !d.channel || !d.evidence) continue;
    const voided = voidByDelivery.get(d.id);
    const view: QuoteSendView = {
      id: d.id, sent_at: d.sent_at, recorded_at: d.recorded_at, channel: d.channel, evidence: d.evidence,
      evidence_ref: d.evidence_ref, note: d.note, sent_by_name: name(d.sent_by), recorded_by_name: name(d.recorded_by),
      kind: voided ? null : (kindByDelivery.get(d.id) ?? null),
      voided: voided?.reason && voided.voided_at ? { reason: voided.reason, at: voided.voided_at } : null,
    };
    sendsByVersion.set(d.quote_version_id, [...(sendsByVersion.get(d.quote_version_id) ?? []), view]);
  }
  for (const list of sendsByVersion.values()) list.sort((a, b) => b.sent_at.localeCompare(a.sent_at));

  const versionsByQuote = new Map<string, QuoteVersionView[]>();
  for (const v of versions ?? []) {
    if (!v.id || !v.quote_id || v.version_no === null || !v.prepared_at || !v.currency || !v.evidence_state) continue;
    const view: QuoteVersionView = {
      id: v.id, version_no: v.version_no, prepared_at: v.prepared_at, issued_at: v.issued_at, total_amount: num(v.total_amount),
      currency: v.currency, external_ref: v.external_ref, valid_until: v.valid_until, evidence_state: v.evidence_state, notes: v.notes,
      sends: sendsByVersion.get(v.id) ?? [],
    };
    versionsByQuote.set(v.quote_id, [...(versionsByQuote.get(v.quote_id) ?? []), view]);
  }
  for (const list of versionsByQuote.values()) list.sort((a, b) => b.version_no - a.version_no);

  const eventsByQuote = new Map<string, QuoteEventView[]>();
  for (const e of events ?? []) {
    if (!e.id || !e.quote_id || !e.event_type || !e.occurred_at || !e.recorded_at) continue;
    eventsByQuote.set(e.quote_id, [...(eventsByQuote.get(e.quote_id) ?? []), { id: e.id, event_type: e.event_type, occurred_at: e.occurred_at, recorded_at: e.recorded_at, actor_name: name(e.actor_id), reason: e.reason }]);
  }

  const quotes: QuoteView[] = (register ?? []).flatMap((q) => {
    if (!q.quote_id || !q.status || !q.lifecycle || !q.origin) return [];
    return [{
      id: q.quote_id, quote_number: q.quote_number, status: q.status, lifecycle: q.lifecycle, origin: q.origin,
      opportunity_id: q.opportunity_id, lead_id: q.lead_id, visit_id: q.visit_id, current_version_no: q.current_version_no ?? 0,
      first_sent_at: q.first_sent_at, first_sent_version_no: q.first_sent_version_no,
      versions: versionsByQuote.get(q.quote_id) ?? [], events: eventsByQuote.get(q.quote_id) ?? [],
    }];
  });

  const evidence: VisitEvidenceView[] = (evidenceRows ?? []).flatMap((e) => {
    if (!e.evidence_key || !e.visit_id || !e.resolution || (e.evidence_kind !== "reference" && e.evidence_kind !== "file")) return [];
    return [{
      evidence_key: e.evidence_key, visit_id: e.visit_id, evidence_kind: e.evidence_kind, file_id: e.file_id,
      reference_text: e.reference_text, amount: num(e.amount), file_name: e.file_name, resolution: e.resolution,
      quote_id: e.quote_id, decided_version_id: e.decided_version_id, decision_id: e.decision_id, decision_reason: e.decision_reason,
      changed_since_decision: !!e.changed_since_decision,
    }];
  });

  return { quotes, evidence };
}

