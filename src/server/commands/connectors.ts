"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { uuid, optionalUuid } from "@/lib/zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requirePermission } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { publicEnv } from "@/lib/env";
import { signPayload } from "@/integrations/signature";

// ------------------------------------------------------------ field mappings

const TARGETS = ["name", "phone", "email", "company", "interest", "product_interest", "area", "notes", "ignore"] as const;

const mappingSchema = z.object({
  id: optionalUuid(),
  provider: z.string().trim().min(1).max(40),
  form_ref: z.string().trim().max(120).optional().or(z.literal("")),
  source_field: z.string().trim().min(1).max(120),
  target_field: z.enum(TARGETS),
  version: z.coerce.number().int().min(1).default(1),
});

export async function upsertFieldMappingAction(input: z.input<typeof mappingSchema>): Promise<ActionResult> {
  try {
    const session = await requirePermission("settings.manage");
    const parsed = mappingSchema.safeParse(input);
    if (!parsed.success) return fail("Check the mapping fields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const d = parsed.data;
    const supabase = await createServerSupabase();
    const row = {
      workspace_id: session.workspaceId,
      provider: d.provider,
      form_ref: d.form_ref || null,
      source_field: d.source_field,
      target_field: d.target_field,
      version: d.version,
    };
    const { error } = d.id ? await supabase.from("field_mappings").update(row).eq("id", d.id) : await supabase.from("field_mappings").insert(row);
    if (error) return fail(error);
    revalidatePath("/platform/connectors");
    return ok(undefined, d.id ? "Mapping updated" : "Mapping added");
  } catch (e) {
    return fail(e);
  }
}

export async function deleteFieldMappingAction(id: string): Promise<ActionResult> {
  try {
    await requirePermission("settings.manage");
    if (!uuid().safeParse(id).success) return fail("Invalid id");
    const supabase = await createServerSupabase();
    const { error } = await supabase.from("field_mappings").delete().eq("id", id);
    if (error) return fail(error);
    revalidatePath("/platform/connectors");
    return ok(undefined, "Mapping removed");
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------ routing rules

const ruleSchema = z.object({
  id: optionalUuid(),
  position: z.coerce.number().int().min(1).max(9999).default(100),
  match_source_channel: z.string().trim().max(40).optional().or(z.literal("")),
  match_product_interest: z.string().trim().max(40).optional().or(z.literal("")),
  assign_to: optionalUuid(),
  is_active: z.boolean().default(true),
});

export async function upsertRoutingRuleAction(input: z.input<typeof ruleSchema>): Promise<ActionResult> {
  try {
    const session = await requirePermission("sales.assign");
    const parsed = ruleSchema.safeParse(input);
    if (!parsed.success) return fail("Check the rule", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const d = parsed.data;
    const supabase = await createServerSupabase();
    const row = {
      workspace_id: session.workspaceId,
      position: d.position,
      match_source_channel: d.match_source_channel || null,
      match_product_interest: d.match_product_interest || null,
      assign_to: d.assign_to || null,
      is_active: d.is_active,
    };
    const { error } = d.id ? await supabase.from("routing_rules").update(row).eq("id", d.id) : await supabase.from("routing_rules").insert(row);
    if (error) return fail(error);
    revalidatePath("/platform/connectors");
    return ok(undefined, d.id ? "Rule updated" : "Rule added");
  } catch (e) {
    return fail(e);
  }
}

export async function deleteRoutingRuleAction(id: string): Promise<ActionResult> {
  try {
    await requirePermission("sales.assign");
    if (!uuid().safeParse(id).success) return fail("Invalid id");
    const supabase = await createServerSupabase();
    const { error } = await supabase.from("routing_rules").delete().eq("id", id);
    if (error) return fail(error);
    revalidatePath("/platform/connectors");
    return ok(undefined, "Rule removed");
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------ intake replay

export async function replayIntakeAction(id: string): Promise<ActionResult<{ lead_id: string | null }>> {
  try {
    await requirePermission("sales.assign");
    if (!uuid().safeParse(id).success) return fail("Invalid id");
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("replay_intake_event", { p_intake_event_id: id });
    if (error) return fail(error);
    const res = data as unknown as { lead_id?: string | null } | null;
    revalidatePath("/platform/connectors");
    revalidatePath("/sales/inbox");
    return ok({ lead_id: res?.lead_id ?? null }, "Submission replayed into the inbox");
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------ connector test

/**
 * Posts a synthetic, correctly signed payload at our own website endpoint so
 * the whole path — signature, freshness, rate limit, mapping, idempotency —
 * is provable without a provider. Demo mode only, and it is labelled as a test
 * in the payload it sends.
 */
export async function sendTestSubmissionAction(): Promise<ActionResult<{ status: number; body: string }>> {
  try {
    await requirePermission("settings.manage");
    if (publicEnv.appMode !== "demo") return fail("Test submissions are only available in demo mode.");
    const secret = process.env.INTAKE_WEBSITE_SECRET;
    if (!secret) return fail("INTAKE_WEBSITE_SECRET is not configured, so the website endpoint is not accepting requests yet.");

    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
    const origin = host ? `${proto}://${host}` : publicEnv.appUrl;

    const stamp = Date.now();
    const body = JSON.stringify({
      submission_id: `test-${stamp}`,
      name: "Test Submission",
      phone: `+6011${String(stamp).slice(-8)}`,
      email: `test-${stamp}@example.test`,
      message: "Synthetic test submission from the connector console. Not a real enquiry.",
      interest: "Wall panel for a feature wall",
      product_interest: ["wall_panel"],
      source_url: `${origin}/platform/connectors`,
      utm_source: "connector-test",
      consent_version: "test",
    });
    const timestamp = String(Math.floor(stamp / 1000));
    const signed = signPayload(secret, body, timestamp);

    const res = await fetch(`${origin}/api/intake/website`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tc-timestamp": signed.timestamp, "x-tc-signature": signed.signature },
      body,
      cache: "no-store",
    });
    const text = await res.text();
    revalidatePath("/platform/connectors");
    revalidatePath("/sales/inbox");
    return ok({ status: res.status, body: text }, res.ok ? "Test submission accepted" : `Endpoint replied ${res.status}`);
  } catch (e) {
    return fail(e);
  }
}
