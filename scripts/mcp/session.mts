/**
 * Member sessions for the marketing-cost MCP server.
 *
 * The server never holds the service-role key and never mints a session for
 * a named email. A member signs in once with `pnpm mcp:marketing-cost:login`,
 * using their own password or a magic link sent to their own inbox, and the
 * resulting Supabase session (refresh token) is kept in a file only they can
 * read (mode 600, or an owner-only ACL on Windows; see file-protection.mts).
 * The server uses only the project URL and the publishable key, so every
 * call is that member's: their JWT, their workspace (core.current_workspace_id)
 * and their role's permissions, checked by the database.
 *
 * TC_MCP_MEMBER_EMAIL is an optional guard, not a credential: if set and it
 * differs from the signed-in member, the server refuses to start.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../import/lib.mts";
import { assertPrivate, ensurePrivateDir, protectFile } from "./file-protection.mts";

export interface PublicTarget { url: string; publishableKey: string }

/** Project URL and publishable key only. A local URL needs --local on purpose. */
export function mcpTarget(flags: Set<string>): PublicTarget {
  loadEnv();
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publishableKey) throw new Error("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required (or present in .env.local).");
  if (/127\.0\.0\.1|localhost/.test(url) && !flags.has("--local")) throw new Error(`${url} is the local stack; pass --local on purpose.`);
  return { url: url.replace(/\/$/, ""), publishableKey };
}

/** ~/.config/tile-concept/mcp-session.json, or %APPDATA%\tile-concept\mcp-session.json on Windows. */
export function sessionFilePath(): string {
  const base = process.platform === "win32" && process.env.APPDATA ? process.env.APPDATA : path.join(os.homedir(), ".config");
  return path.resolve(process.env.TC_MCP_SESSION_FILE ?? path.join(base, "tile-concept", "mcp-session.json"));
}

interface SessionFile { url: string; items: Record<string, string> }
const STORAGE_KEY = "tc-mcp-session";

function readFile(file: string): SessionFile | null {
  if (!fs.existsSync(file)) return null;
  assertPrivate(file);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as SessionFile;
  if (typeof parsed?.url !== "string" || typeof parsed.items !== "object") throw new Error(`${file} is not a Tile Concept MCP session file.`);
  return parsed;
}

function writeFile(file: string, data: SessionFile) {
  ensurePrivateDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  // Restrict the file before the tokens are written into it.
  fs.writeFileSync(tmp, "", { mode: 0o600 });
  protectFile(tmp);
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
  protectFile(file);
}

/** supabase-js storage backed by the session file, so refresh-token rotation is persisted. */
function fileStorage(file: string, url: string) {
  const load = () => readFile(file) ?? { url, items: {} };
  return {
    getItem: (key: string) => load().items[key] ?? null,
    setItem: (key: string, value: string) => { const d = load(); d.items[key] = value; writeFile(file, { url, items: d.items }); },
    removeItem: (key: string) => { const d = load(); delete d.items[key]; writeFile(file, { url, items: d.items }); },
  };
}

function client(t: PublicTarget, file: string, autoRefreshToken: boolean) {
  return createClient(t.url, t.publishableKey, {
    auth: { storage: fileStorage(file, t.url), storageKey: STORAGE_KEY, persistSession: true, autoRefreshToken, detectSessionInUrl: false },
    db: { schema: "api" },
  });
}

export interface Member { client: ReturnType<typeof client>; userId: string; email: string; workspace: string; role: string }

/**
 * Restore the signed-in member from the session file. Refuses when there is
 * no session, when it belongs to another project, when Supabase Auth does not
 * accept it, when TC_MCP_MEMBER_EMAIL names someone else, or when the member
 * has no active workspace membership.
 */
export async function memberFromSession(t: PublicTarget, file = sessionFilePath()): Promise<Member> {
  const stored = readFile(file);
  if (!stored?.items[STORAGE_KEY]) throw new Error(`No signed-in member. Run \`pnpm mcp:marketing-cost:login\` first (session file: ${file}).`);
  if (stored.url !== t.url) throw new Error(`The session in ${file} is for ${stored.url}, not ${t.url}. Sign in again for this project.`);
  const db = client(t, file, true);
  // getUser() asks Supabase Auth to validate the token (after refreshing it);
  // a forged or revoked session fails here.
  const { error: sessionError } = await db.auth.getSession();
  const { data: { user }, error } = await db.auth.getUser();
  if (sessionError || error || !user?.email) {
    db.auth.stopAutoRefresh();
    throw new Error(`The saved session is no longer valid (${(sessionError ?? error)?.message ?? "no user"}). Run \`pnpm mcp:marketing-cost:login\` again.`);
  }
  const expected = process.env.TC_MCP_MEMBER_EMAIL?.trim().toLowerCase();
  if (expected && expected !== user.email.toLowerCase()) {
    db.auth.stopAutoRefresh();
    throw new Error(`TC_MCP_MEMBER_EMAIL is ${expected}, but the saved session belongs to ${user.email}. An email alone never selects a member; sign in as that member instead.`);
  }
  const { data: membership, error: mError } = await db.rpc("my_membership").maybeSingle<{ workspace_name: string; role_label: string }>();
  if (mError || !membership) {
    db.auth.stopAutoRefresh();
    throw new Error(`${user.email} has no active workspace membership${mError ? ` (${mError.message})` : ""}.`);
  }
  return { client: db, userId: user.id, email: user.email, workspace: membership.workspace_name, role: membership.role_label };
}

export async function loginWithPassword(t: PublicTarget, email: string, password: string, file = sessionFilePath()) {
  const db = client(t, file, false);
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Sign-in failed: ${error?.message ?? "no session"}`);
  return data.user.email;
}

/** Sends the normal sign-in email; never creates an account. */
export async function requestMagicLink(t: PublicTarget, email: string) {
  const db = createClient(t.url, t.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await db.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) throw new Error(`Could not send the sign-in email: ${error.message}`);
}

/** Accepts the link from the sign-in email (or its token_hash) and redeems it once. */
export async function loginWithMagicLink(t: PublicTarget, linkOrHash: string, file = sessionFilePath()) {
  const trimmed = linkOrHash.trim();
  let tokenHash = trimmed;
  try { tokenHash = new URL(trimmed.replace(/&amp;/g, "&")).searchParams.get("token_hash") ?? ""; } catch { /* a bare token hash */ }
  if (!/^[A-Za-z0-9_-]{20,}$/.test(tokenHash)) throw new Error("That is not a sign-in link from Tile Concept.");
  const db = client(t, file, false);
  const { data, error } = await db.auth.verifyOtp({ type: "email", token_hash: tokenHash });
  if (error || !data.session) throw new Error(`The link was not accepted (it works once and expires): ${error?.message ?? "no session"}`);
  return data.user?.email ?? null;
}

/** Revokes the refresh token with Supabase Auth and deletes the session file. */
export async function logout(t: PublicTarget, file = sessionFilePath()) {
  if (!fs.existsSync(file)) return false;
  const db = client(t, file, false);
  await db.auth.signOut({ scope: "local" });
  fs.rmSync(file, { force: true });
  return true;
}
