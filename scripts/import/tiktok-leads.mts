/**
 * Reconcile the Enquiry Box with a TikTok lead-generation export.
 *
 *   pnpm exec tsx scripts/import/tiktok-leads.mts "<TC - Lead Generation Total.xlsx>" [--commit] [--sheet=lead_generation]
 *
 * Every row goes through api.accept_intake with the same idempotency key the
 * first export import used (`tiktok:lead:<lead_id>`), so re-running is safe
 * and a lead that already exists is left alone. Rows are matched to existing
 * contacts by exact phone or email inside the function, never by name.
 *
 * The export's column order differs between TikTok's two download shapes
 * (Phone/Email/Final page/Name vs Email/Final page/Name/Phone), and a sheet
 * updated by hand can hold both. Each row is read by content, not position.
 */
import XLSX from "xlsx";
import { adminClient, args, counter, log, normalizePhone, norm, readWorkbook, target, text } from "./lib.mts";

const WORKSPACE_ID = process.env.TC_INTAKE_WORKSPACE_ID ?? "638c7f4d-39f2-420b-96d7-6e403cf51cc3"; // Tile Concept
const PROVIDER = "tiktok_export";

const PRODUCT_INTEREST: [RegExp, string][] = [
  [/wall panel/i, "wall_panel"],
  [/jubin|tile/i, "tile"],
  [/potong|cut/i, "cut_tile"],
  [/mosaic/i, "mosaic"],
];

function parseCreated(v: unknown): string | null {
  const s = String(v ?? "").trim();
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(s);
  if (!m) return null;
  const tz = /\(UTC([+-]\d{2}):(\d{2})\)/.exec(s);
  const offset = tz ? `${tz[1]}:${tz[2]}` : "Z";
  return new Date(`${m[1]}T${m[2]}${offset === "Z" ? "Z" : offset}`).toISOString();
}

async function main() {
  const { file, commit, flags } = args();
  const sheetName = [...flags].find((f) => f.startsWith("--sheet="))?.slice(8) ?? "lead_generation";
  const t = target(flags);
  const wb = readWorkbook(file);
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`sheet "${sheetName}" not found; sheets: ${wb.SheetNames.join(", ")}`);
  const rows = (XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false }) as unknown[][]).filter((r) => text(r[0]));
  const header = rows[0].map(norm);
  const data = rows.slice(1);
  const col = (name: string) => header.findIndex((h) => h === name);
  const iCreated = col("created_time");
  const iForm = col("form_name");
  const iCampaign = col("campaign_name");
  const iSource = col("source");
  const iState = col("province/state");
  const iWho = header.findIndex((h) => h.startsWith("anda ialah"));
  const iLooking = header.findIndex((h) => h.startsWith("apa yang anda cari"));
  const iDetails = header.findIndex((h) => h.startsWith("boleh berikan") || h === "inquiry details");
  const iProject = header.findIndex((h) => h.startsWith("projek ini"));
  // The identity block sits between the ad account and the state column in both shapes.
  const iAccount = col("ad account");
  const identityCols = [iAccount + 1, iAccount + 2, iAccount + 3, iAccount + 4];

  log(`target ${t.ref} · workspace ${WORKSPACE_ID} · sheet "${sheetName}" · ${data.length} rows · ${commit ? "COMMIT" : "dry run"}`);

  const admin = adminClient(t);
  const { data: existing, error } = await admin.from("intake_events").select("external_id").eq("workspace_id", WORKSPACE_ID).in("provider", [PROVIDER, "tiktok"]);
  if (error) throw error;
  const known = new Set((existing ?? []).map((e) => String(e.external_id)));

  const c = counter<string>();
  const seenPhones = new Set<string>();
  let accepted = 0;
  let linked = 0;
  let duplicates = 0;
  for (const r of data) {
    const leadId = String(r[0]).trim();
    if (known.has(leadId)) {
      c.add("already in the inbox");
      continue;
    }
    const cells = identityCols.map((i) => text(r[i]));
    const email = cells.find((v) => v && /@/.test(v)) ?? null;
    const phoneRaw = cells.find((v) => v && /^\+?\d[\d\s()-]{6,}$/.test(v)) ?? null;
    const name = cells.find((v) => v && v !== email && v !== phoneRaw && !/^final page/i.test(v)) ?? null;
    const phone = normalizePhone(phoneRaw);
    if (!phone && !email) {
      c.add("skipped: no phone or email");
      continue;
    }
    if (phone && seenPhones.has(phone)) c.add("same phone as an earlier new row (will merge)");
    if (phone) seenPhones.add(phone);
    const occurredAt = parseCreated(r[iCreated]);
    if (!occurredAt) c.add("no parseable created_time (accepted with now)");
    const looking = text(r[iLooking]);
    const who = text(r[iWho]);
    const project = text(r[iProject]);
    const details = text(r[iDetails]);
    const state = text(r[iState]);
    const source = text(r[iSource]);
    const productInterest = looking ? PRODUCT_INTEREST.filter(([re]) => re.test(looking)).map(([, k]) => k) : [];
    c.add(`looking for: ${looking ?? "blank"}`);
    c.add(`state: ${state ?? "blank"}`);
    c.add(`who: ${who ?? "blank"}`);
    c.add(`source: ${source ?? "blank"}`);

    if (!commit) {
      c.add("new");
      continue;
    }
    const payload: Record<string, unknown> = {};
    header.forEach((h, i) => {
      if (h && r[i] !== null && r[i] !== undefined && String(r[i]).trim() !== "") payload[h] = r[i];
    });
    const notes = [who, project, details].filter(Boolean).join(" · ") || null;
    const { data: res, error: err } = await admin.rpc("accept_intake", {
      p_workspace_id: WORKSPACE_ID,
      p_source_channel: "tiktok",
      p_provider: PROVIDER,
      p_external_id: leadId,
      p_idempotency_key: `tiktok:lead:${leadId}`,
      p_payload: { ...payload, form_name: text(r[iForm]), campaign_name: text(r[iCampaign]) },
      p_fields: {
        name,
        phone: phoneRaw,
        email,
        interest: looking,
        area: state,
        notes,
        product_interest: productInterest,
        source_detail: text(r[iForm]),
      },
      p_occurred_at: occurredAt,
      p_form_ref: text(r[iForm]),
    });
    if (err) {
      c.add(`error: ${err.message.slice(0, 60)}`);
      continue;
    }
    const out = res as { lead_id: string; duplicate: boolean; matched_contact_id: string | null };
    if (out.duplicate) duplicates += 1;
    else accepted += 1;
    if (out.matched_contact_id) linked += 1;
    // The enquiry arrived when TikTok says it did, not when this script ran.
    if (occurredAt && !out.duplicate) {
      await admin
        .from("leads")
        .update({ created_at: occurredAt, first_response_due_at: new Date(new Date(occurredAt).getTime() + 4 * 3_600_000).toISOString() })
        .eq("id", out.lead_id);
    }
  }
  log(`known before: ${known.size}`);
  log(c.table());
  if (commit) log(`accepted ${accepted} · merged into an existing lead ${duplicates} · auto-linked to a contact ${linked}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
