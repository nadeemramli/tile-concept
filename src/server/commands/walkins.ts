"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuid } from "@/lib/zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requirePermission } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { normalizePhone } from "@/lib/identity/normalize";
import { correctPurchaseSchema, importRowSchema, walkInSchema, type ImportRow, type WalkInInput } from "@/features/walkins/schema";
import type { InquiryChoice, OpenOpportunityRef, WalkInInquiryMatches, WalkInResult } from "@/features/walkins/types";
import type { IdentityCandidate } from "@/features/inbox/types";

const blank = (v: string | undefined | null) => (v && v.length > 0 ? v : undefined);

function revalidateWalkins() {
  revalidatePath("/sales/walk-ins");
  revalidatePath("/sales/inbox");
  revalidatePath("/sales/pipeline");
  revalidatePath("/sales/accounts");
  revalidatePath("/");
}

export async function getWalkInInquiriesAction(contactId: string, occurredAt: string): Promise<ActionResult<WalkInInquiryMatches>> {
  const parsed = z.object({ contactId: uuid(), occurredAt: z.iso.datetime({ offset: true }) }).safeParse({ contactId, occurredAt });
  if (!parsed.success) return fail("Choose a customer and a valid visit date.");
  try {
    await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("walk_in_inquiries", { p_contact_id: contactId, p_occurred_at: occurredAt });
    if (error) return fail(error);
    return ok(data as unknown as WalkInInquiryMatches);
  } catch (e) { return fail(e); }
}

export async function resolveVisitInquiryAction(visitId: string, choice: InquiryChoice, version: number): Promise<ActionResult> {
  const parsed = z.object({ visitId: uuid(), mode: z.enum(["choose", "new", "unlinked"]), leadId: uuid().or(z.literal("")), reason: z.string().trim().min(5).max(1000), version: z.number().int().nonnegative() }).safeParse({ visitId, ...choice, version });
  if (!parsed.success || (choice.mode === "choose" && !choice.leadId)) return fail("Choose a correction and give a reason of at least 5 characters.");
  try {
    await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { error } = await supabase.rpc("resolve_visit_inquiry", { p_visit_id: visitId, p_mode: choice.mode, p_lead_id: choice.leadId || undefined, p_reason: parsed.data.reason, p_expected_version: version });
    if (error) return fail(error);
    revalidateWalkins();
    return ok(undefined, "Inquiry link updated; the reason is saved in history.");
  } catch (e) { return fail(e); }
}

export async function findCandidatesAction(input: { phone?: string; email?: string; name?: string; company?: string }): Promise<ActionResult<IdentityCandidate[]>> {
  try {
    await requirePermission("sales.read");
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("find_identity_candidates", {
      p_phone: blank(input.phone),
      p_email: blank(input.email),
      p_name: blank(input.name),
      p_company: blank(input.company),
      p_limit: 10,
    });
    if (error) return fail(error);
    return ok(
      (data ?? []).map((c) => ({
        entity_type: c.entity_type as IdentityCandidate["entity_type"],
        entity_id: String(c.entity_id),
        display_name: String(c.display_name ?? ""),
        confidence: (c.confidence as IdentityCandidate["confidence"]) ?? "low",
        score: Number(c.score ?? 0),
        reasons: (c.reasons as unknown as IdentityCandidate["reasons"]) ?? [],
        masked_phone: c.masked_phone,
        masked_email: c.masked_email,
        lifecycle_state: c.lifecycle_state,
        last_activity_at: c.last_activity_at,
      })),
    );
  } catch (e) {
    return fail(e);
  }
}

export async function createWalkInContactAction(input: { display_name: string; phone?: string; email?: string; customer_type?: string; source?: string; provisional?: boolean; account_id?: string }): Promise<ActionResult<{ contact_id: string; duplicates: number }>> {
  if (input.account_id && !uuid().safeParse(input.account_id).success) return fail("Choose a valid company.");
  const name = z.string().trim().min(2).max(200).safeParse(input.display_name);
  if (!name.success) return fail("Enter the customer's name (at least 2 characters).");
  try {
    await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { data: contactId, error } = await supabase.rpc("create_contact", {
      p_display_name: name.data,
      p_account_id: input.account_id || undefined,
      p_phone: blank(input.phone),
      p_email: blank(input.email),
      p_customer_type: blank(input.customer_type),
      p_source: blank(input.source),
      p_is_provisional: !!input.provisional,
    });
    if (error || !contactId) return fail(error ?? "Could not create contact");
    let duplicates = 0;
    if (input.provisional) {
      const { data } = await supabase.rpc("suggest_contact_duplicates", { p_contact_id: contactId });
      duplicates = Number(data ?? 0);
    }
    revalidatePath("/sales/identity-review");
    return ok({ contact_id: contactId, duplicates }, input.provisional ? `Provisional contact created${duplicates ? ` · ${duplicates} possible duplicate${duplicates > 1 ? "s" : ""} sent to review` : ""}.` : "Contact created.");
  } catch (e) {
    return fail(e);
  }
}

export async function getOpenOpportunitiesAction(contactId: string): Promise<ActionResult<OpenOpportunityRef[]>> {
  try {
    await requirePermission("sales.read");
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.from("opportunities").select("id, name, stage_key, project_id").eq("contact_id", contactId).eq("status", "open").is("archived_at", null).order("created_at", { ascending: false }).limit(20);
    if (error) return fail(error);
    return ok((data ?? []).map((o) => ({ id: String(o.id), name: String(o.name ?? ""), stage_key: String(o.stage_key ?? ""), project_id: o.project_id })));
  } catch (e) {
    return fail(e);
  }
}

export async function recordWalkInAction(input: WalkInInput): Promise<ActionResult<WalkInResult>> {
  const parsed = walkInSchema.safeParse(input);
  if (!parsed.success) return fail("Check the walk-in details.", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const v = parsed.data;
  if (v.purchase) {
    const paid = v.purchase.payments.reduce((s, p) => s + p.amount, 0);
    if (v.purchase.payments.length > 0 && paid - v.purchase.amount > 0.005) return fail(`Payments (${paid.toFixed(2)}) cannot exceed the purchase amount (${v.purchase.amount.toFixed(2)}).`);
  }
  try {
    await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const purchase = v.purchase
      ? {
          amount: v.purchase.amount,
          external_ref: blank(v.purchase.external_ref) ?? null,
          payments: v.purchase.payments.map((p) => ({ method: p.method, amount: p.amount, reference: blank(p.reference) ?? null })),
          items: v.purchase.items.map((i) => ({ description: i.description, quantity: i.quantity, unit: blank(i.unit) ?? null, unit_price: i.unit_price ?? null, product_variant_id: blank(i.product_variant_id) ?? null })),
          purchase_source: v.purchase.purchase_source || "walk_in",
          notes: blank(v.purchase.notes) ?? null,
        }
      : undefined;
    const { data, error } = await supabase.rpc("record_showroom_visit", {
      p_request_id: v.request_id,
      p_input: {
        ...v,
        create_opportunity: v.opportunity_mode === "create",
        opportunity_id: v.opportunity_mode === "link" ? blank(v.opportunity_id) ?? null : null,
        purchase: purchase ?? null,
      },
    });
    if (error) return fail(error);
    const res = data as unknown as WalkInResult;
    revalidateWalkins();
    return ok(res, "Walk-in recorded.");
  } catch (e) {
    return fail(e);
  }
}

export async function correctPurchaseAction(input: z.input<typeof correctPurchaseSchema>): Promise<ActionResult> {
  const parsed = correctPurchaseSchema.safeParse(input);
  if (!parsed.success) return fail("Enter the corrected amount and a reason of at least 5 characters.");
  const v = parsed.data;
  try {
    await requirePermission("purchase.correct");
    const supabase = await createServerSupabase();
    const { data: p, error: readError } = await supabase.from("purchases").select("version").eq("id", v.purchase_id).single();
    if (readError) return fail(readError);
    const { error } = await supabase.rpc("sale_command", { p_action: "correct_legacy", p_request_id: crypto.randomUUID(), p_input: { purchase_id: v.purchase_id, version: p.version, amount: v.amount, reason: v.reason } });
    if (error) return fail(error);
    revalidateWalkins();
    return ok(undefined, "Purchase corrected and audited.");
  } catch (e) {
    return fail(e);
  }
}

/** Bulk duplicate check for import preview: ORC numbers already recorded, and phone+date visits. */
export async function checkImportDuplicatesAction(rows: { row_no: number; orc_number?: string; phone?: string; date?: string }[]): Promise<ActionResult<{ duplicate_rows: number[]; reasons: Record<number, string> }>> {
  try {
    await requirePermission("sales.read");
    const supabase = await createServerSupabase();
    const orcs = Array.from(new Set(rows.map((r) => r.orc_number?.trim()).filter((x): x is string => !!x)));
    const phones = Array.from(new Set(rows.map((r) => normalizePhone(r.phone)).filter((x): x is string => !!x)));
    const [{ data: existingOrc }, { data: points }] = await Promise.all([
      orcs.length ? supabase.from("purchases").select("external_ref").in("external_ref", orcs) : Promise.resolve({ data: [] as { external_ref: string | null }[] }),
      phones.length ? supabase.from("contact_points").select("contact_id, normalized_value").in("normalized_value", phones) : Promise.resolve({ data: [] as { contact_id: string | null; normalized_value: string | null }[] }),
    ]);
    const orcSet = new Set((existingOrc ?? []).map((x) => x.external_ref));
    const contactByPhone = new Map((points ?? []).map((p) => [String(p.normalized_value), String(p.contact_id)]));
    const contactIds = Array.from(new Set(Array.from(contactByPhone.values())));
    const { data: visits } = contactIds.length
      ? await supabase.from("visits").select("contact_id, occurred_at").in("contact_id", contactIds)
      : { data: [] as { contact_id: string | null; occurred_at: string | null }[] };
    const visitDays = new Set((visits ?? []).map((v) => `${v.contact_id}|${String(v.occurred_at).slice(0, 10)}`));
    const duplicate_rows: number[] = [];
    const reasons: Record<number, string> = {};
    for (const r of rows) {
      if (r.orc_number && orcSet.has(r.orc_number.trim())) {
        duplicate_rows.push(r.row_no);
        reasons[r.row_no] = `ORC ${r.orc_number.trim()} already recorded`;
        continue;
      }
      const ph = normalizePhone(r.phone);
      const cid = ph ? contactByPhone.get(ph) : undefined;
      if (cid && r.date && visitDays.has(`${cid}|${r.date.slice(0, 10)}`)) {
        duplicate_rows.push(r.row_no);
        reasons[r.row_no] = "A visit for this phone already exists on that date";
      }
    }
    return ok({ duplicate_rows, reasons });
  } catch (e) {
    return fail(e);
  }
}

export interface ImportCommitResult {
  visits: number;
  purchases: number;
  contacts_created: number;
  contacts_reused: number;
  skipped: number;
  errors: { row_no: number; error: string }[];
}

export async function commitImportAction(rows: ImportRow[], options: { location_id?: string; default_source?: string }): Promise<ActionResult<ImportCommitResult>> {
  if (rows.length === 0) return fail("Nothing to import.");
  if (rows.length > 500) return fail("Import at most 500 rows per commit.");
  try {
    const session = await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const result: ImportCommitResult = { visits: 0, purchases: 0, contacts_created: 0, contacts_reused: 0, skipped: 0, errors: [] };
    const phoneCache = new Map<string, string>();
    const staffCache = new Map<string, string | undefined>();
    for (const raw of rows) {
      const parsed = importRowSchema.safeParse(raw);
      if (!parsed.success) {
        result.skipped += 1;
        result.errors.push({ row_no: raw.row_no, error: "Row failed validation" });
        continue;
      }
      const r = parsed.data;
      const phone = normalizePhone(r.phone);
      if (!phone) {
        result.skipped += 1;
        result.errors.push({ row_no: r.row_no, error: "Invalid phone" });
        continue;
      }
      let contactId = phoneCache.get(phone);
      if (!contactId) {
        const { data: cp, error: pointError } = await supabase.from("contact_points").select("contact_id, is_shared").eq("normalized_value", phone).in("kind", ["phone", "whatsapp"]);
        if (pointError) { result.skipped += 1; result.errors.push({ row_no: r.row_no, error: pointError.message }); continue; }
        const ids = Array.from(new Set((cp ?? []).map((p) => p.contact_id).filter((id): id is string => !!id)));
        if (ids.length > 1 || cp?.some((p) => p.is_shared)) {
          result.skipped += 1; result.errors.push({ row_no: r.row_no, error: "Shared or ambiguous phone: confirm the customer using New walk-in." }); continue;
        }
        if (ids.length === 1) {
          contactId = ids[0];
          result.contacts_reused += 1;
        } else {
          const { data: created, error } = await supabase.rpc("create_contact", {
            p_display_name: r.customer_name,
            p_phone: r.phone,
            p_customer_type: blank(r.customer_type)?.toLowerCase(),
            p_is_provisional: false,
          });
          if (error || !created) {
            result.skipped += 1;
            result.errors.push({ row_no: r.row_no, error: error?.message ?? "Could not create contact" });
            continue;
          }
          contactId = created;
          result.contacts_created += 1;
        }
        phoneCache.set(phone, contactId);
      }
      const staff = r.salesperson ? await resolveStaff(r.salesperson, staffCache) : undefined;
      const purchase =
        r.amount !== null && r.amount > 0
          ? { amount: r.amount, external_ref: blank(r.orc_number) ?? null, payments: r.payments.length ? r.payments : [], items: [], purchase_source: "walk_in", notes: `Imported row ${r.row_no}` }
          : undefined;
      const { data, error } = await supabase.rpc("record_showroom_visit", {
        p_request_id: crypto.randomUUID(),
        p_input: {
          contact_id: contactId,
          location_id: options.location_id ?? session.defaultLocationId ?? null,
          staff_user_id: staff ?? null,
          occurred_at: new Date(r.date.length === 10 ? `${r.date}T00:00:00+08:00` : r.date).toISOString(),
          customer_type: blank(r.customer_type)?.toLowerCase() ?? null,
          origin_area: blank(r.origin_area) ?? null,
          inquiry_source: blank(r.inquiry_source)?.toLowerCase() ?? options.default_source ?? null,
          purpose: purchase ? "purchase" : "browse",
          notes: `Imported from walk-in workbook (row ${r.row_no})${r.new_existing ? ` · sheet said ${r.new_existing}` : ""}`,
          create_opportunity: false,
          product_interest: [],
          purchase: purchase ?? null,
          renovation_area: blank(r.renovation_area) ?? null,
          quotation_ref: blank(r.quotation_ref) ?? null,
          quotation_amount: r.quotation_amount,
        },
      });
      if (error) {
        result.skipped += 1;
        result.errors.push({ row_no: r.row_no, error: error.message });
        continue;
      }
      result.visits += 1;
      if ((data as { purchase_id?: string | null } | null)?.purchase_id) result.purchases += 1;
    }
    revalidateWalkins();
    return ok(result, `Imported ${result.visits} visit${result.visits === 1 ? "" : "s"}, ${result.purchases} purchase${result.purchases === 1 ? "" : "s"}.`);
  } catch (e) {
    return fail(e);
  }
}

async function resolveStaff(name: string, staffCache: Map<string, string | undefined>): Promise<string | undefined> {
  const key = name.trim().toLowerCase();
  if (!key) return undefined;
  if (staffCache.has(key)) return staffCache.get(key);
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("profiles").select("user_id, full_name");
  const hit = (data ?? []).find((p) => (p.full_name ?? "").toLowerCase() === key || (p.full_name ?? "").toLowerCase().startsWith(key));
  const id = hit?.user_id ?? undefined;
  staffCache.set(key, id);
  return id;
}
