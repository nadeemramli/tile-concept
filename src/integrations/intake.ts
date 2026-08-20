import "server-only";

import { createAdminSupabase } from "@/lib/supabase/admin";
import { applyMappings, type FieldMapping, type MappedFields } from "@/integrations/mapping";

/**
 * Shared connector plumbing: the workspace a connector writes into, the
 * mapping rows for a provider, and the single call that durably accepts a
 * submission. Server-only — it holds the service-role client.
 */

export interface AcceptResult {
  intake_event_id: string;
  lead_id: string | null;
  duplicate: boolean;
  matched_contact_id?: string | null;
}

/** The workspace inbound connectors write into. Single-workspace launch. */
export async function resolveIntakeWorkspaceId(): Promise<string | null> {
  const configured = process.env.TC_INTAKE_WORKSPACE_ID;
  if (configured) return configured;
  // Fall back to the only workspace when exactly one exists, so a demo stack
  // works without extra configuration. Ambiguity is an error, not a guess.
  const admin = createAdminSupabase();
  const { data } = await admin.from("workspaces").select("id").limit(2);
  return data && data.length === 1 ? (data[0].id ?? null) : null;
}

export async function loadFieldMappings(workspaceId: string, provider: string): Promise<FieldMapping[]> {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("field_mappings")
    .select("source_field, target_field, form_ref, version")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .order("version", { ascending: false });
  return (data ?? []).map((m) => ({
    source_field: m.source_field ?? "",
    target_field: (m.target_field ?? "ignore") as FieldMapping["target_field"],
    form_ref: m.form_ref,
    version: m.version,
  }));
}

export interface AcceptArgs {
  workspaceId: string;
  sourceChannel: string;
  provider: string;
  externalId: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  fields: MappedFields;
  occurredAt?: string | null;
  formRef?: string | null;
  rawText?: string | null;
}

/**
 * Durable acceptance. The route acknowledges only after this returns, so a
 * provider retry finds the original event rather than creating a second lead.
 */
export async function acceptIntake(args: AcceptArgs): Promise<AcceptResult> {
  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc("accept_intake", {
    p_workspace_id: args.workspaceId,
    p_source_channel: args.sourceChannel,
    p_provider: args.provider,
    p_external_id: args.externalId,
    p_idempotency_key: args.idempotencyKey,
    p_payload: args.payload as never,
    p_fields: args.fields as never,
    p_occurred_at: args.occurredAt ?? undefined,
    p_form_ref: args.formRef ?? undefined,
    p_raw_text: args.rawText ?? undefined,
  });
  if (error) throw new Error(error.message);
  return data as unknown as AcceptResult;
}

/** Maps a provider payload through the stored mappings for that provider. */
export async function mapProviderPayload(workspaceId: string, provider: string, payload: Record<string, unknown>, formRef?: string | null) {
  const mappings = await loadFieldMappings(workspaceId, provider);
  return applyMappings(payload, mappings, formRef);
}
