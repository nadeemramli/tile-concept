import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSession, requireSession } from "./session";

const mock = vi.hoisted(() => ({ user: vi.fn(), membership: vi.fn(), permissions: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: mock.user() } }) },
    rpc: (fn: string) => (fn === "my_membership" ? { maybeSingle: async () => mock.membership() } : mock.permissions()),
    from: () => ({ select: () => ({ eq: () => Object.assign(Promise.resolve({ data: [] }), { maybeSingle: async () => ({ data: null }) }) }) }),
  }),
}));

const USER = { id: "aaaaaaaa-0000-0000-0000-000000000099", email: "e2e.session@tileconcept.test" };

beforeEach(() => {
  mock.user.mockReturnValue(USER);
  mock.permissions.mockResolvedValue({ data: [], error: null });
});
afterEach(() => vi.resetAllMocks());

describe("session resolution (TILE-67)", () => {
  it("is null for a signed-in account with no active membership, and requireSession sends it to /no-access, not /login", async () => {
    mock.membership.mockResolvedValue({ data: null, error: null });
    await expect(getSession()).resolves.toBeNull();
    await expect(requireSession()).rejects.toThrow("redirect:/no-access");
  });

  it("is null without a signed-in user", async () => {
    mock.user.mockReturnValue(null);
    await expect(getSession()).resolves.toBeNull();
  });

  it.each([
    ["membership", () => mock.membership.mockResolvedValue({ data: null, error: { code: "57014", message: "timeout" } })],
    ["permissions", () => {
      mock.membership.mockResolvedValue({ data: { workspace_id: "w", workspace_name: "W", workspace_slug: "w", role_key: "admin", role_label: "Admin", default_location_id: null, timezone: "Asia/Kuala_Lumpur", currency: "MYR" }, error: null });
      mock.permissions.mockResolvedValue({ data: null, error: { code: "57014", message: "timeout" } });
    }],
  ] as const)("treats a failed %s read as a failure, never as no membership", async (_, arrange) => {
    arrange();
    await expect(getSession()).rejects.toThrow("Could not load your workspace membership");
    await expect(requireSession()).rejects.not.toThrow("redirect:");
  });
});
