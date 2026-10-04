/**
 * MCP server (stdio) for marketing-cost imports.
 *
 *   TC_MCP_MEMBER_EMAIL=<member email> pnpm mcp:marketing-cost [--local]
 *
 * The tools act as that workspace member through a one-time-link session,
 * exactly like scripts/import: `auth.uid()`, the role's permissions and the
 * audit trail are the member's. The service-role key is used only to mint
 * that session; it never reads or writes marketing tables. The member is
 * never defaulted: without TC_MCP_MEMBER_EMAIL the server refuses to start.
 * A local Supabase URL is refused unless --local is passed on purpose.
 *
 * Claude Code: claude mcp add tile-marketing-cost -e TC_MCP_MEMBER_EMAIL=… -- pnpm --silent mcp:marketing-cost
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { target, userClient } from "../import/lib.mts";
import { createMarketingCostServer, type MarketingCostDb } from "./marketing-cost-tools.mts";

async function main() {
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
  const email = process.env.TC_MCP_MEMBER_EMAIL?.trim();
  if (!email) throw new Error("Set TC_MCP_MEMBER_EMAIL to the member the tools act as (a marketing coordinator, sales manager or admin to import).");
  const t = target(flags);
  const { client } = await userClient(t, email);
  const server = createMarketingCostServer(client as unknown as MarketingCostDb, email);
  await server.connect(new StdioServerTransport());
  // stdout is the protocol channel; diagnostics go to stderr.
  console.error(`tile-concept marketing-cost MCP server · ${t.ref} · acting as ${email}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
