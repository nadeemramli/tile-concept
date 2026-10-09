/**
 * Sign in a member for the marketing-cost MCP server (run in a terminal).
 *
 *   pnpm mcp:marketing-cost:login [--local]            sign in (password or emailed link)
 *   pnpm mcp:marketing-cost:login --status [--local]   who is signed in
 *   pnpm mcp:marketing-cost:login --logout [--local]   revoke the session and delete the file
 *
 * Proof of identity is the member's own password, or the one-time link sent
 * to their own inbox. The session file (default
 * ~/.config/tile-concept/mcp-session.json, %APPDATA%\tile-concept on Windows,
 * or TC_MCP_SESSION_FILE) is readable only by its owner: mode 600, or an
 * owner-only ACL on Windows. No service-role key is read or needed.
 */
import readline from "node:readline";
import { Writable } from "node:stream";
import { loginWithMagicLink, loginWithPassword, logout, mcpTarget, memberFromSession, requestMagicLink, sessionFilePath } from "./session.mts";

// One interface for the whole dialogue, so typed-ahead or piped answers are kept.
let muted = false;
const output = new Writable({ write(chunk, _enc, cb) { if (!muted) process.stdout.write(chunk); cb(); } });
const rl = readline.createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();
async function ask(question: string, hidden = false): Promise<string> {
  output.write(question);
  muted = hidden;
  const { value } = await lines.next();
  muted = false;
  if (hidden) process.stdout.write("\n");
  return String(value ?? "").trim();
}

async function main() {
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
  const t = mcpTarget(flags);
  const file = sessionFilePath();
  if (flags.has("--logout")) {
    console.log((await logout(t, file)) ? `Signed out; ${file} deleted.` : "No saved session.");
    return;
  }
  if (flags.has("--status")) {
    const m = await memberFromSession(t, file);
    console.log(`${m.email} · ${m.role} · ${m.workspace} · ${t.url}`);
    m.client.auth.stopAutoRefresh();
    return;
  }
  console.log(`Signing in to ${t.url} for the marketing-cost MCP tools.`);
  const email = await ask("Member email: ");
  const method = (await ask("Sign in with [p]assword or an emailed [l]ink? ")).toLowerCase();
  if (method.startsWith("l")) {
    await requestMagicLink(t, email);
    console.log("A sign-in email is on its way. Copy the link from it (do not open it in a browser: it works once) and paste it here.");
    await loginWithMagicLink(t, await ask("Link: "), file);
  } else {
    await loginWithPassword(t, email, await ask("Password: ", true), file);
  }
  const m = await memberFromSession(t, file);
  m.client.auth.stopAutoRefresh();
  console.log(`Signed in as ${m.email} (${m.role}, ${m.workspace}). Session saved to ${file}.`);
}

main().then(() => { rl.close(); process.exit(0); }).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
