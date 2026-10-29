/**
 * MCP server (stdio) for marketing-cost imports.
 *
 *   pnpm mcp:marketing-cost:login          # once, in a terminal: the member signs in
 *   pnpm --silent mcp:marketing-cost       # started by Claude Code / Codex
 *
 * The tools act as the member who signed in (see session.mts): their JWT,
 * workspace and role permissions, enforced by the database. The server needs
 * only SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (from the
 * environment or .env.local); it never reads the service-role key, and an
 * email setting alone cannot select or impersonate a member. A local URL is
 * refused unless --local is passed on purpose.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMarketingCostServer, type MarketingCostDb } from "./marketing-cost-tools.mts";
import { mcpTarget, memberFromSession } from "./session.mts";

async function main() {
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
  const t = mcpTarget(flags);
  const member = await memberFromSession(t);
  const server = createMarketingCostServer(member.client as unknown as MarketingCostDb, `${member.email} (${member.role}, ${member.workspace})`);
  await server.connect(new StdioServerTransport());
  // stdout is the protocol channel; diagnostics go to stderr.
  console.error(`tile-concept marketing-cost MCP server · ${t.url} · ${member.email} · ${member.role} · ${member.workspace}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
