"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requirePermission } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { normalizePhone } from "@/lib/identity/normalize";
import { correctPurchaseSchema, importRowSchema, walkInSchema, type ImportRow, type WalkInInput } from "@/features/walkins/schema";
import type { OpenOpportunityRef, WalkInResult } from "@/features/walkins/types";
import type { IdentityCandidate } from "@/features/inbox/types";

const blank = (v: string | undefined | null) => (v && v.length > 0 ? v : undefined);

function revalidateWalkins() {
  revalidatePath("/sales/walk-ins");
  revalidatePath("/sales/inbox");
  revalidatePath("/sales/pipeline");
  revalidatePath("/sales/accounts");
  revalidatePath("/");
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
        entity_type: c.entity_type as "contact" | "account",
        entity_id: String(c.entity_id),
        display_name: String(c.display_name ?? ""),
        confidence: (c.confidence as IdentityCandidate["confidence"]) ?? "low",
        score: Number(c.score ?? 0),
        reasons: (c.reasons as IdentityCandidate["reasons"]) ?? [],
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

export async function createWalkInContactAction(input: { display_name: string; phone?: string; email?: string; customer_type?: string; source?: string; provisional?: boolean }): Promise<ActionResult<{ contact_id: string; duplicates: number }>> {
  const name = z.string().trim().min(2).max(200).safeParse(input.display_name);
  if (!name.success) return fail("Enter the customer's name (at least 2 characters).");
  try {
    await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { data: contactId, error } = await supabase.rpc("create_contact", {
      p_display_name: name.data,
      p_phone: blank(input.phone),
      p_email: blank(input.email),
      p_customer_type: blank(input.customer_type),
      p_source: blank(input.source) ?? "walk_in",
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
    const { data, error } = await supabase.from("opportunities").select("id, name, stage_key, project_id").eq("contact_id", contactId).eq("status", "open").order("created_at", { ascending: false }).limit(20);
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
    if (v.purchase.payments.length > 0 && Math.abs(paid - v.purchase.amount) > 0.005) return fail(`Payments (${paid.toFixed(2)}) must equal the purchase amount (${v.purchase.amount.toFixed(2)}).`);
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
    const { data, error } = await supabase.rpc("record_walk_in", {
      p_contact_id: v.contact_id,
      p_account_id: blank(v.account_id),
      p_location_id: blank(v.location_id),
      p_staff_user_id: blank(v.staff_user_id),
      p_occurred_at: new Date(v.occurred_at).toISOString(),
      p_customer_type: blank(v.customer_type),
      p_origin_area: blank(v.origin_area),
      p_inquiry_source: blank(v.inquiry_source),
      p_purpose: v.purpose,
      p_notes: blank(v.notes),
      p_create_opportunity: v.opportunity_mode === "create",
      p_opportunity_id: v.opportunity_mode === "link" ? blank(v.opportunity_id) : undefined,
      p_project_name: blank(v.project_name),
      p_opportunity_name: blank(v.opportunity_name),
      p_product_interest: v.product_interest,
      p_purchase: purchase,
    });
    if (error) return fail(error);
    revalidateWalkins();
    return ok(data as unknown as WalkInResult, "Walk-in recorded.");
  } catch (e) {
    return fail(e);
  }
}

export async function correctPurchaseAction(input: z.input<typeof correctPurchaseSchema>): Promise<ActionResult> {
  const parsed = correctPurchaseSchema.safeParse(input);
  if (!parsed.success) return fail("Enter the corrected amount and a reason of at least 5 characters.");
  const v = parsed.data;
  try {
    const session = await requirePermission("purchase.correct");
    const supabase = await createServerSupabase();
    const { data: p } = await supabase.from("purchases").select("id, amount, notes, contact_id, account_id, opportunity_id, project_id, visit_id, workspace_id").eq("id", v.purchase_id).maybeSingle();
    if (!p) return fail("Purchase not found");
    const old = Number(p.amount ?? 0);
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const note = `${p.notes ? p.notes + "\n" : ""}[${stamp}] Corrected ${old.toFixed(2)} → ${v.amount.toFixed(2)}: ${v.reason}`;
    const { error } = await supabase.from("purchases").update({ amount: v.amount, status: "corrected", notes: note }).eq("id", v.purchase_id);
    if (error) return fail(error);
    await supabase.from("activities").insert({
      workspace_id: session.workspaceId,
      kind: "note",
      subject: "Purchase corrected",
      body: `Amount ${old.toFixed(2)} → ${v.amount.toFixed(2)}. Reason: ${v.reason}`,
      actor_id: session.userId,
      contact_id: p.contact_id,
      account_id: p.account_id,
      opportunity_id: p.opportunity_id,
      project_id: p.project_id,
      visit_id: p.visit_id,
      purchase_id: v.purchase_id,
      metadata: { old_amount: old, new_amount: v.amount },
    });
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
        const { data: cp } = await supabase.from("contact_points").select("contact_id").eq("normalized_value", phone).in("kind", ["phone", "whatsapp"]).limit(1);
        if (cp && cp.length > 0 && cp[0].contact_id) {
          contactId = String(cp[0].contact_id);
          result.contacts_reused += 1;
        } else {
          const { data: created, error } = await supabase.rpc("create_contact", {
            p_display_name: r.customer_name,
            p_phone: r.phone,
            p_customer_type: blank(r.customer_type)?.toLowerCase(),
            p_source: blank(r.inquiry_source)?.toLowerCase() ?? options.default_source ?? "walk_in",
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
      const staff = r.salesperson ? await resolveStaff(r.salesperson) : undefined;
      const purchase =
        r.amount !== null && r.amount > 0
          ? { amount: r.amount, external_ref: blank(r.orc_number) ?? null, payments: r.payments.length ? r.payments : [], items: [], purchase_source: "walk_in", notes: `Imported row ${r.row_no}` }
          : undefined;
      const { data, error } = await supabase.rpc("record_walk_in", {
        p_contact_id: contactId,
        p_location_id: options.location_id ?? session.defaultLocationId ?? undefined,
        p_staff_user_id: staff,
        p_occurred_at: new Date(r.date).toISOString(),
        p_customer_type: blank(r.customer_type)?.toLowerCase(),
        p_origin_area: blank(r.origin_area),
        p_inquiry_source: blank(r.inquiry_source)?.toLowerCase(),
        p_purpose: purchase ? "purchase" : "browse",
        p_notes: `Imported from walk-in workbook (row ${r.row_no})${r.new_existing ? ` · sheet said ${r.new_existing}` : ""}`,
        p_create_opportunity: false,
        p_product_interest: [],
        p_purchase: purchase,
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

const staffCache = new Map<string, string | undefined>();
async function resolveStaff(name: string): Promise<string | undefined> {
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
