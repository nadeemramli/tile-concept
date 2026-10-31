import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

// Pin English for copy-based specs. workspace-entry.spec.ts clears this cookie
// to exercise the English default and explicitly selects BM to test persistence.
const english = {
  cookies: [{ name: "tc.locale", value: "en", domain: new URL(baseURL).hostname, path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" as const }],
  origins: [],
};

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  use: { baseURL, trace: "retain-on-failure", storageState: english },
  reporter: [["list"]],
  // Reuses a running `pnpm dev` when there is one (Next 16 refuses to start a
  // second dev server in the same directory), otherwise starts its own.
  // Requires a local Supabase stack: pnpm db:start && pnpm db:reset
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm exec next dev -p ${PORT}`,
        url: `http://localhost:${PORT}/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
