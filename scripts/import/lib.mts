/**
 * Shared plumbing for one-off spreadsheet imports against the hosted project.
 *
 *   SUPABASE_URL=… SUPABASE_SECRET_KEY=… pnpm exec tsx scripts/import/<script>.mts <file> [--commit]
 *
 * Missing variables are read from .env.local so the usual local setup works
 * without exporting anything. Nothing in these scripts prints a customer
 * name, phone or email: dry runs report counts and categories only.
 *
 * Two clients are used on purpose. The service-role client is for reads that
 * need no user (which rows already exist) and for `api.accept_intake`, which is
 * designed for a connector rather than a member. Everything that records a
 * visit or a purchase goes through the same `api.*` functions the app calls,
 * as a real member session minted with a one-time magic link, so `auth.uid()`,
 * permissions and the audit trail behave exactly as they do in the UI.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

export function loadEnv(): void {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1];
    const raw = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = raw;
  }
}

export interface Target {
  url: string;
  secretKey: string;
  publishableKey: string;
  ref: string;
}

/**
 * Resolves the project to write to. A local URL is refused unless `--local`
 * was passed: `.env.local` usually points at the local stack, and a customer
 * import that silently lands there is worse than one that fails.
 */
export function target(flags: Set<string> = new Set()): Target {
  loadEnv();
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !secretKey || !publishableKey) {
    throw new Error("SUPABASE_URL, SUPABASE_SECRET_KEY and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required (or present in .env.local).");
  }
  const local = /127\.0\.0\.1|localhost/.test(url);
  if (local && !flags.has("--local")) {
    throw new Error(`${url} is the local stack. Set SUPABASE_URL / SUPABASE_SECRET_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY for the hosted project, or pass --local on purpose.`);
  }
  const ref = /https?:\/\/([^.]+)\.supabase\./.exec(url)?.[1] ?? new URL(url).host;
  return { url, secretKey, publishableKey, ref };
}

export function adminClient(t: Target) {
  return createClient(t.url, t.secretKey, { auth: { autoRefreshToken: false, persistSession: false }, db: { schema: "api" } });
}

/**
 * A client acting as `email`, through the same one-time-link exchange the app
 * uses for guest access. No email is sent; the token is single-use.
 */
export async function userClient(t: Target, email: string): Promise<{ client: ReturnType<typeof adminClient>; userId: string }> {
  const admin = createClient(t.url, t.secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError || !link?.properties?.hashed_token) throw new Error(`could not mint a session for ${email}: ${linkError?.message ?? "no token"}`);
  const anon = createClient(t.url, t.publishableKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await anon.auth.verifyOtp({ type: "email", token_hash: link.properties.hashed_token });
  if (error || !data.session) throw new Error(`could not redeem the session for ${email}: ${error?.message ?? "no session"}`);
  const client = createClient(t.url, t.publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: "api" },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
  return { client, userId: data.session.user.id };
}

export function args(): { file: string; commit: boolean; flags: Set<string> } {
  const rest = process.argv.slice(2);
  const file = rest.find((a) => !a.startsWith("--"));
  if (!file) throw new Error("pass the workbook path as the first argument");
  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  return { file: path.resolve(file), commit: flags.has("--commit"), flags };
}

export function readWorkbook(file: string): XLSX.WorkBook {
  return XLSX.readFile(file, { cellDates: false, raw: true });
}

export const norm = (h: unknown): string => String(h ?? "").replace(/\s+/g, " ").trim().toLowerCase();
export const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "" || s === "-" ? null : s;
};
export const yes = (v: unknown): boolean => /^(y|yes|ya|true|1|✓|x)$/i.test(String(v ?? "").trim());
export const money = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && String(v).trim() !== "" && String(v).trim() !== "-" ? Math.round(n * 100) / 100 : null;
};

/** Excel serial → ISO date (YYYY-MM-DD), or null. */
export function serialToIsoDate(n: unknown): string | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 30000) return null;
  return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
}

/** A showroom-day timestamp: local noon in Kuala Lumpur, so the date never shifts in either zone. */
export function noonKl(isoDate: string): string {
  return `${isoDate}T04:00:00.000Z`;
}

/** Malaysian phone normalisation mirroring core.normalize_phone: digits, national 0 → +60. */
export function normalizePhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  let d = String(raw).replace(/[^0-9]/g, "");
  if (!d) return null;
  if (d.startsWith("600")) d = d.slice(2);
  if (d.startsWith("60") && d.length >= 11) return `+${d}`;
  if (d.startsWith("0")) return `+60${d.slice(1)}`;
  if (d.length >= 9 && d.length <= 10) return `+60${d}`;
  return d.length >= 11 ? `+${d}` : null;
}

export function counter<K extends string>() {
  const c = new Map<K, number>();
  return {
    add: (k: K, n = 1) => c.set(k, (c.get(k) ?? 0) + n),
    get: (k: K) => c.get(k) ?? 0,
    table: () => [...c.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(" | "),
  };
}

export function log(...parts: unknown[]): void {
  console.log(...parts);
}
