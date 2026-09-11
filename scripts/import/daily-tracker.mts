/**
 * Import the showroom "Daily Tracker" workbook: one visit per row, with the
 * customer resolved by phone, the purchase when a collection was recorded,
 * and the tracker's own fields (From, Area renovation, SQ number, quotation
 * amount, how they heard) on the visit.
 *
 *   pnpm exec tsx scripts/import/daily-tracker.mts "<TC_Daily_Tracker.xlsx>" --as=<member email> [--commit] [--sheets=Mar26,Apr26]
 *
 * Runs as the named member (a one-time magic link, nothing emailed) so every
 * write goes through api.create_contact / api.record_walk_in exactly as the
 * app does, with the member as `created_by` and the row's SMP as the staff.
 *
 * Sheets: every tab named like `Oct'24` or `Mar26`. Both header layouts are
 * handled (the 2024-25 Creative Lab sheet and the 2026 Tile Concept sheet).
 * The sheet's title row names the showroom, which picks the location.
 *
 * Idempotent by (phone, date): a row whose customer already has a visit on
 * that day is skipped, so a re-run only adds what is missing.
 *
 * What is normalised rather than copied (PRD §5.4): "Walk in?", "Online
 * enquiry?" and the payment flags become purpose, inquiry source and
 * payment rows; the sheet's free-text purpose, its New/Existing status, and
 * anything the app has no column for (Vsoft demo, TI service, slab enquiry,
 * an unrecognised SMP) are kept verbatim in the visit notes.
 */
import XLSX from "xlsx";
import { adminClient, args, counter, log, money, noonKl, norm, normalizePhone, readWorkbook, serialToIsoDate, target, text, userClient, yes } from "./lib.mts";

const WORKSPACE_ID = process.env.TC_INTAKE_WORKSPACE_ID ?? "638c7f4d-39f2-420b-96d7-6e403cf51cc3";

/** Showroom named on the sheet's title row → business location. */
const LOCATIONS: { match: RegExp; code: string; name: string; active: boolean }[] = [
  { match: /kd showroom|tile concept/i, code: "hq", name: "HQ Showroom", active: true },
  { match: /elmina lakeside|creative lab|^cl /i, code: "cl-elmina", name: "CL Elmina Lakeside", active: false },
];

const CUSTOMER_TYPE: [RegExp, string][] = [
  [/home ?owner/i, "homeowner"],
  [/contractor/i, "contractor"],
  [/designer|\bid\b/i, "designer"],
  [/architect/i, "architect"],
  [/developer/i, "developer"],
  [/retail/i, "retailer"],
];

const INQUIRY_SOURCE: [RegExp, string][] = [
  [/passing/i, "walk_in"],
  [/google|search|website/i, "website"],
  [/instagram|facebook|threads|meta/i, "meta"],
  [/tiktok/i, "tiktok"],
  [/recommend|referr|friend/i, "referral"],
  [/existing/i, "existing_customer"],
  [/cold call|call/i, "call"],
  [/whatsapp/i, "whatsapp"],
];

const PAYMENT_CODE: [RegExp, string][] = [
  [/cash/i, "cash"],
  [/cc|card|visa|master/i, "card"],
  [/online|transfer|ibg|duitnow|fpx/i, "bank_transfer"],
  [/tng|grab|boost|wallet/i, "ewallet"],
  [/cheque/i, "cheque"],
];

function purposeFor(freeText: string | null, hasPurchase: boolean, walkIn: boolean): string {
  const s = (freeText ?? "").toLowerCase();
  if (hasPurchase || /made payment|paid|deposit/.test(s)) return "purchase";
  if (/collect/.test(s)) return "collection";
  if (/sample/.test(s)) return "sample";
  if (/consult|discuss|appointment|meeting|site visit|measure/.test(s)) return "consultation";
  if (/follow ?up|revisit|come back/.test(s)) return "follow_up";
  if (/survey|look|browse|choose|select|find|view|check|compare|enquir|inquir|ask|price|quot/.test(s)) return "browse";
  return walkIn ? "browse" : "other";
}

interface Row {
  sheet: string;
  rowNo: number;
  date: string;
  smp: string | null;
  name: string;
  phone: string | null;
  phoneRaw: string | null;
  from: string | null;
  status: string | null;
  customerType: string | null;
  receipt: string | null;
  amount: number | null;
  walkIn: boolean | null;
  online: boolean | null;
  pay: { cash: boolean; card: boolean; transfer: boolean };
  sq: string | null;
  quotation: number | null;
  renovation: string | null;
  purposeText: string | null;
  heard: string | null;
  extras: string[];
  location: (typeof LOCATIONS)[number];
}

function parseSheet(wb: XLSX.WorkBook, name: string): Row[] {
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }) as unknown[][];
  const title = rows.slice(0, 3).flat().map((c) => String(c ?? "")).join(" ");
  const location = LOCATIONS.find((l) => l.match.test(title)) ?? LOCATIONS[0];
  const hi = rows.findIndex((r) => norm(r[0]) === "no" && norm(r[2]) === "smp");
  if (hi < 0) throw new Error(`${name}: header row not found`);
  const headers = rows[hi].map(norm);
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = headers.findIndex((h) => h === n || h.startsWith(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const c = {
    date: 1,
    smp: col("smp"),
    name: col("customer name"),
    phone: col("customer contact", "contact"),
    from: col("from"),
    status: col("customer status"),
    type: col("customer type"),
    receipt: col("orc number", "deposit receipt number"),
    amount: col("collection amount"),
    walkIn: col("walk in?"),
    online: col("online enquiry?", "online inquiry"),
    cash: col("cash payment"),
    card: col("cc terminal payment"),
    transfer: col("online payment"),
    sq: col("sq number", "quotation number"),
    quotation: col("quotation amount"),
    renovation: col("area renovation"),
    purpose: col("customer visit purpose"),
    heard: col("how customer know"),
    vsoft: col("vsoft demo"),
    ti: col("ti service"),
    slab: col("slab enquiry"),
  };
  // Month implied by the tab name, for rows whose date cell is not a real date.
  const m = /^([A-Za-z]{3})[a-z]*'?(\d\d)/.exec(name.trim());
  const monthIdx = m ? ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1].toLowerCase()) : -1;
  const year = m ? 2000 + Number(m[2]) : NaN;
  const fallbackDate = (v: unknown): string | null => {
    if (monthIdx < 0) return null;
    const day = typeof v === "number" && v >= 1 && v <= 31 ? Math.round(v) : null;
    const s = String(v ?? "");
    const d = day ?? (/^(\d{1,2})[-/ ]/.exec(s) ? Number(RegExp.$1) : null);
    if (!d) return null;
    return `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };

  const out: Row[] = [];
  let lastDate: string | null = null;
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const customerName = text(r[c.name]);
    if (!customerName || /^summary/i.test(customerName)) continue;
    let date = serialToIsoDate(r[c.date]) ?? fallbackDate(r[c.date]);
    if (!date && lastDate) date = lastDate; // a blank date cell under the previous day's entry
    if (!date) continue;
    lastDate = date;
    const phoneRaw = text(r[c.phone]);
    const extras: string[] = [];
    for (const [label, idx] of [
      ["Vsoft demo", c.vsoft],
      ["TI service", c.ti],
      ["Slab enquiry", c.slab],
    ] as const) {
      const v = idx >= 0 ? text(r[idx]) : null;
      if (v && !/^no$/i.test(v)) extras.push(`${label}: ${v}`);
    }
    out.push({
      sheet: name.trim(),
      rowNo: i + 1,
      date,
      smp: text(r[c.smp]),
      name: customerName,
      phone: normalizePhone(phoneRaw),
      phoneRaw,
      from: text(r[c.from]),
      status: text(r[c.status]),
      customerType: text(r[c.type]),
      receipt: text(r[c.receipt]),
      amount: c.amount >= 0 ? money(r[c.amount]) : null,
      walkIn: c.walkIn >= 0 && text(r[c.walkIn]) ? yes(r[c.walkIn]) : null,
      online: c.online >= 0 && text(r[c.online]) ? yes(r[c.online]) : null,
      pay: { cash: c.cash >= 0 && yes(r[c.cash]), card: c.card >= 0 && yes(r[c.card]), transfer: c.transfer >= 0 && yes(r[c.transfer]) },
      sq: c.sq >= 0 ? text(r[c.sq]) : null,
      quotation: c.quotation >= 0 ? money(r[c.quotation]) : null,
      renovation: c.renovation >= 0 ? text(r[c.renovation]) : null,
      purposeText: c.purpose >= 0 ? text(r[c.purpose]) : null,
      heard: c.heard >= 0 ? text(r[c.heard]) : null,
      extras,
      location,
    });
  }
  return out;
}

/** ORC → payment method and reference from the accounting export tab, when present. */
function collectionIndex(wb: XLSX.WorkBook): Map<string, { method: string; reference: string | null }> {
  const map = new Map<string, { method: string; reference: string | null }>();
  const ws = wb.Sheets["Daily Collection"];
  if (!ws) return map;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false }) as unknown[][];
  for (const r of rows.slice(1)) {
    const doc = text(r[1]);
    if (!doc) continue;
    const code = text(r[4]) ?? "";
    const method = PAYMENT_CODE.find(([re]) => re.test(code))?.[1] ?? "other";
    map.set(doc.toUpperCase(), { method, reference: text(r[5]) });
  }
  return map;
}

function mapOne(list: [RegExp, string][], v: string | null, fallback: string | null): string | null {
  if (!v) return fallback;
  return list.find(([re]) => re.test(v))?.[1] ?? fallback;
}

async function main() {
  const { file, commit, flags } = args();
  const asEmail = [...flags].find((f) => f.startsWith("--as="))?.slice(5);
  const only = [...flags].find((f) => f.startsWith("--sheets="))?.slice(9).split(",").map((s) => s.trim());
  if (commit && !asEmail) throw new Error("--commit needs --as=<member email>");
  const t = target(flags);
  const wb = readWorkbook(file);
  const sheets = wb.SheetNames.filter((n) => /^[A-Za-z]{3,4}'?\d\d\s*$/.test(n)).filter((n) => !only || only.includes(n.trim()));
  const collections = collectionIndex(wb);
  const all = sheets.flatMap((n) => parseSheet(wb, n)).sort((a, b) => a.date.localeCompare(b.date) || a.rowNo - b.rowNo);
  log(`target ${t.ref} · ${sheets.length} sheets · ${all.length} rows · ${commit ? `COMMIT as ${asEmail}` : "dry run"}`);

  const admin = adminClient(t);
  const { data: memberships } = await admin.from("memberships").select("user_id").eq("workspace_id", WORKSPACE_ID);
  const memberIds = new Set((memberships ?? []).map((m) => String(m.user_id)));
  const { data: profiles } = await admin.from("profiles").select("user_id, full_name");
  const members = (profiles ?? []).filter((p) => memberIds.has(String(p.user_id)));
  const staffByPrefix = new Map<string, string>();
  for (const m of members) {
    const key = String(m.full_name ?? "").toLowerCase().split(/[.\s@]/)[0];
    if (key) staffByPrefix.set(key, String(m.user_id));
  }
  const staffFor = (smp: string | null) => (smp ? staffByPrefix.get(smp.toLowerCase().split(/[\s.]/)[0]) ?? null : null);

  const { data: locs } = await admin.from("business_locations").select("id, code, name, is_active").eq("workspace_id", WORKSPACE_ID);
  const locationId = new Map<string, string>();
  for (const l of LOCATIONS) {
    const hit = (locs ?? []).find((x) => x.code === l.code || x.name === l.name);
    if (hit) locationId.set(l.code, String(hit.id));
  }

  // Existing visits by (phone, day) and existing contacts by phone: the idempotency key.
  const { data: points } = await admin.from("contact_points").select("contact_id, normalized_value").eq("workspace_id", WORKSPACE_ID).in("kind", ["phone", "whatsapp"]);
  const contactByPhone = new Map<string, string>();
  for (const p of points ?? []) if (!contactByPhone.has(String(p.normalized_value))) contactByPhone.set(String(p.normalized_value), String(p.contact_id));
  const { data: visits } = await admin.from("visits").select("contact_id, occurred_at").eq("workspace_id", WORKSPACE_ID);
  const visitKeys = new Set((visits ?? []).map((v) => `${v.contact_id}|${String(v.occurred_at).slice(0, 10)}`));

  const c = counter<string>();
  const perSheet = counter<string>();
  const staffMissing = counter<string>();
  const newPhones = new Set<string>();
  let planned = 0;
  for (const r of all) {
    perSheet.add(r.sheet);
    if (!locationId.get(r.location.code)) c.add(`location to create: ${r.location.name}`);
    const staff = staffFor(r.smp);
    if (r.smp && !staff) staffMissing.add(r.smp.toUpperCase());
    if (!r.phone) c.add("no usable phone (contact created by name, provisional)");
    const existingContact = r.phone ? contactByPhone.get(r.phone) : undefined;
    if (existingContact && visitKeys.has(`${existingContact}|${r.date}`)) {
      c.add("skipped: visit already recorded for that phone and day");
      continue;
    }
    if (r.phone && !existingContact) newPhones.add(r.phone);
    c.add(`customer type: ${mapOne(CUSTOMER_TYPE, r.customerType, "other")}`);
    c.add(`heard: ${mapOne(INQUIRY_SOURCE, r.heard, r.walkIn === false && r.online ? "website" : "walk_in")}`);
    const hasPurchase = r.amount !== null && r.amount > 0;
    c.add(`purpose: ${purposeFor(r.purposeText, hasPurchase, r.walkIn !== false)}`);
    if (hasPurchase) c.add("purchase");
    else if (r.receipt) c.add("receipt number without an amount (kept in notes)");
    if (r.sq) c.add("quotation ref");
    planned += 1;
  }
  log(`sheets: ${perSheet.table()}`);
  log(`rows planned: ${planned} · contacts to create: ${newPhones.size} phones + ${c.get("no usable phone (contact created by name, provisional)")} by name · existing contacts reused: ${[...new Set(all.map((r) => r.phone).filter((p): p is string => !!p && contactByPhone.has(p)))].length}`);
  if (staffMissing.table()) log(`SMP with no member account (kept in notes, staff left blank): ${staffMissing.table()}`);
  log(c.table());
  if (!commit) return;

  const { client: me, userId } = await userClient(t, asEmail!);
  log(`acting as ${asEmail} (${userId.slice(0, 8)}…)`);
  for (const l of LOCATIONS) {
    if (locationId.get(l.code)) continue;
    if (!all.some((r) => r.location.code === l.code)) continue;
    const { data, error } = await me.from("business_locations").insert({ workspace_id: WORKSPACE_ID, code: l.code, name: l.name, kind: "showroom", is_active: l.active }).select("id").single();
    if (error) throw new Error(`could not create location ${l.name}: ${error.message}`);
    locationId.set(l.code, String(data.id));
    log(`created location ${l.name}${l.active ? "" : " (inactive)"}`);
  }

  const done = counter<string>();
  const errors: string[] = [];
  const created = new Map<string, string>(); // phone or name key → contact id, within this run
  for (const r of all) {
    const staff = staffFor(r.smp);
    let contactId = r.phone ? (contactByPhone.get(r.phone) ?? created.get(r.phone)) : created.get(`name:${r.name.toLowerCase()}`);
    if (contactId && visitKeys.has(`${contactId}|${r.date}`)) {
      done.add("skipped (already recorded)");
      continue;
    }
    const customerType = mapOne(CUSTOMER_TYPE, r.customerType, null);
    const heard = mapOne(INQUIRY_SOURCE, r.heard, r.walkIn === false && r.online ? "website" : "walk_in");
    if (!contactId) {
      const { data: id, error } = await me.rpc("create_contact", {
        p_display_name: r.name,
        p_phone: r.phoneRaw ?? undefined,
        p_customer_type: customerType ?? undefined,
        p_source: heard === "existing_customer" ? "walk_in" : heard,
        p_is_provisional: !r.phone,
      });
      if (error || !id) {
        errors.push(`${r.sheet} row ${r.rowNo}: contact: ${error?.message ?? "no id"}`);
        continue;
      }
      contactId = String(id);
      created.set(r.phone ?? `name:${r.name.toLowerCase()}`, contactId);
      done.add(r.phone ? "contact created" : "contact created (provisional, no phone)");
    } else {
      done.add("contact reused");
    }

    const hasPurchase = r.amount !== null && r.amount > 0;
    const purpose = purposeFor(r.purposeText, hasPurchase, r.walkIn !== false);
    const noteParts = [
      `Imported from Daily Tracker ${r.sheet} row ${r.rowNo}`,
      r.status ? `Sheet status: ${r.status}` : null,
      r.purposeText ? `Purpose: ${r.purposeText}` : null,
      r.walkIn !== null ? `Walk in: ${r.walkIn ? "Yes" : "No"}` : null,
      r.online !== null ? `Online enquiry: ${r.online ? "Yes" : "No"}` : null,
      r.heard ? `How they heard: ${r.heard}` : null,
      r.smp && !staff ? `SMP (sheet): ${r.smp}` : null,
      r.receipt && !hasPurchase ? `Receipt ${r.receipt} (amount not on sheet)` : null,
      ...r.extras,
    ].filter(Boolean);

    let purchase: Record<string, unknown> | null = null;
    if (hasPurchase) {
      const orc = r.receipt?.toUpperCase() ?? null;
      const acct = orc ? collections.get(orc) : undefined;
      const flagged = [r.pay.cash && "cash", r.pay.card && "card", r.pay.transfer && "bank_transfer"].filter(Boolean) as string[];
      const method = flagged[0] ?? acct?.method ?? null;
      purchase = {
        amount: r.amount,
        external_ref: r.receipt,
        payments: method ? [{ method, amount: r.amount, reference: acct?.reference ?? null }] : [],
        items: [],
        purchase_source: r.walkIn === false && r.online ? "online" : "walk_in",
        notes: `Imported from Daily Tracker ${r.sheet} row ${r.rowNo}`,
      };
    }

    const { data: res, error } = await me.rpc("record_walk_in", {
      p_contact_id: contactId,
      p_location_id: locationId.get(r.location.code),
      p_staff_user_id: staff ?? undefined,
      p_occurred_at: noonKl(r.date),
      p_customer_type: customerType ?? undefined,
      p_origin_area: r.from ?? undefined,
      p_inquiry_source: heard,
      p_purpose: purpose,
      p_notes: noteParts.join(" · "),
      p_create_opportunity: false,
      p_product_interest: [],
      p_purchase: purchase,
    });
    if (error || !res) {
      errors.push(`${r.sheet} row ${r.rowNo}: visit: ${error?.message ?? "no result"}`);
      continue;
    }
    const out = res as { visit_id: string; lead_id: string; purchase_id: string | null };
    visitKeys.add(`${contactId}|${r.date}`);
    done.add("visit");
    if (out.purchase_id) done.add("purchase");

    const patch: Record<string, unknown> = {};
    if (r.renovation) patch.renovation_area = r.renovation;
    if (r.sq) patch.quotation_ref = r.sq;
    if (r.quotation !== null && r.quotation > 0) patch.quotation_amount = r.quotation;
    if (!staff) patch.staff_user_id = null; // the function defaults to the caller; the sheet's SMP is in the notes
    if (Object.keys(patch).length) {
      const { error: pe } = await me.from("visits").update(patch).eq("id", out.visit_id);
      if (pe) errors.push(`${r.sheet} row ${r.rowNo}: visit patch: ${pe.message}`);
    }
    // The inbox copy of the visit dates from the visit, not from today.
    await me.from("leads").update({ created_at: noonKl(r.date) }).eq("id", out.lead_id);
    if (!staff) await me.from("leads").update({ owner_id: null }).eq("id", out.lead_id);
  }
  log(done.table());
  if (errors.length) {
    log(`${errors.length} errors:`);
    for (const e of errors.slice(0, 30)) log("  " + e);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
