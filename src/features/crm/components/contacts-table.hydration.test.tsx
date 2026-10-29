/**
 * Server render → hydrate the real AccountsContactsView, DataTable and
 * formatRelative with the server and browser clocks controlled separately.
 * CI run 40840713071 failed on exactly this: the Created cell's text moved
 * from 57 to 58 seconds between server render and hydration. Only routing,
 * URL state, session and the create dialogs are stubbed.
 */
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ContactListRow } from "@/server/queries/contacts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("nuqs", () => {
  const parser = { withDefault: (value: string) => ({ ...parser, defaultValue: value }), withOptions: () => parser, defaultValue: null as string | null };
  return { parseAsString: parser, useQueryState: (_key: string, p?: { defaultValue: string | null }) => [p?.defaultValue ?? null, vi.fn()] };
});
vi.mock("@/components/shell/session-context", () => {
  const permissions = new Set(["sales.read", "sales.write"]);
  return { useSession: () => ({ session: { userId: "u-1", roleLabel: "Sales representative" }, permissions, can: (p: string) => permissions.has(p) }) };
});
vi.mock("@/features/crm/components/dialogs", () => ({ NewContactDialog: () => null, NewAccountDialog: () => null }));

const { AccountsContactsView } = await import("./contacts-table");

// Tell React this is a test environment so act() does not warn; every other
// console.error during hydration is collected and fails the test.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SERVER_NOW = Date.parse("2026-10-29T08:00:00.000Z");
const ago = (ms: number) => new Date(SERVER_NOW - ms).toISOString();
const THREE_DAYS = 3 * 86_400_000;

function contact(overrides: Partial<ContactListRow>): ContactListRow {
  return {
    id: "c-1", display_name: "Synthetic Contact", customer_type: "homeowner", lifecycle_state: "new", original_acquisition_source: "walk_in",
    is_provisional: false, merged_into_contact_id: null, created_at: ago(THREE_DAYS), primary_phone: null, primary_email: null,
    account_id: null, account_name: null, open_opportunities: 0, last_activity_at: null, ...overrides,
  };
}

function view(row: ContactListRow) {
  // renderedAt is the server's request time, passed down by the page. The
  // tooltip provider normally comes from the app shell (src/app/providers.tsx).
  return (
    <TooltipProvider delayDuration={200}>
      <AccountsContactsView contacts={[row]} accounts={[]} members={[]} includeMerged={false} renderedAt={SERVER_NOW} />
    </TooltipProvider>
  );
}

function cellText(container: HTMLElement, header: string) {
  const headers = Array.from(container.querySelectorAll("thead th")).map((th) => th.textContent ?? "");
  const index = headers.findIndex((text) => text.startsWith(header));
  expect(index, `${header} column`).toBeGreaterThanOrEqual(0);
  return container.querySelectorAll("tbody tr")[0].querySelectorAll("td")[index].textContent;
}

interface Hydrated { serverText: string; hydratedText: string; liveText: string; errors: string[]; container: HTMLElement }
let root: Root | null = null;

/** Server-renders at SERVER_NOW, hydrates `skewMs` later, then lets mount effects run. */
async function serverThenHydrate(row: ContactListRow, header: string, skewMs: number): Promise<Hydrated> {
  vi.setSystemTime(SERVER_NOW);
  const html = renderToString(view(row));
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  const serverText = cellText(container, header)!;

  vi.setSystemTime(SERVER_NOW + skewMs);
  const errors: string[] = [];
  const consoleError = vi.spyOn(console, "error").mockImplementation((...args) => errors.push(String(args[0])));
  let hydratedText = "";
  await act(async () => {
    root = hydrateRoot(container, view(row), { onRecoverableError: (error) => errors.push(String((error as Error).message ?? error)) });
  });
  hydratedText = cellText(container, header)!;
  // Mount effects (requestAnimationFrame) move the labels onto the live clock.
  await act(async () => {
    vi.advanceTimersToNextFrame();
  });
  const liveText = cellText(container, header)!;
  consoleError.mockRestore();
  return { serverText, hydratedText, liveText, errors, container };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame"] });
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const CELLS = [
  { header: "Created", row: (ms: number) => contact({ created_at: ago(ms) }) },
  { header: "Last activity", row: (ms: number) => contact({ last_activity_at: ago(ms) }) },
];

describe.each(CELLS)("$header cell: server render and hydration agree", ({ header, row }) => {
  it("same clock: 57 seconds, no hydration error (control)", async () => {
    const r = await serverThenHydrate(row(57_000), header, 0);
    expect(r.serverText).toBe("57 seconds ago");
    expect(r.hydratedText).toBe("57 seconds ago");
    expect(r.errors).toEqual([]);
  });

  it("browser clock 1000 ms ahead: 57 → 58 seconds after mount, no hydration error", async () => {
    const r = await serverThenHydrate(row(57_000), header, 1_000);
    expect(r.errors).toEqual([]);
    expect(r.serverText).toBe("57 seconds ago");
    expect(r.hydratedText).toBe("57 seconds ago");
    expect(r.liveText).toBe("58 seconds ago");
  });

  it("crossing the just-now boundary (44.5 s → 45.5 s): no hydration error", async () => {
    const r = await serverThenHydrate(row(44_500), header, 1_000);
    expect(r.errors).toEqual([]);
    expect(r.serverText).toBe("just now");
    expect(r.hydratedText).toBe("just now");
    expect(r.liveText).toBe("46 seconds ago");
  });

  it("keeps following the live clock after mount", async () => {
    const r = await serverThenHydrate(row(57_000), header, 1_000);
    expect(r.liveText).toBe("58 seconds ago");
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(cellText(r.container, header)).toBe("2 minutes ago");
  });
});

describe("cells without a usable time", () => {
  it("a contact with no activity shows a dash, before and after mount", async () => {
    const r = await serverThenHydrate(contact({ last_activity_at: null }), "Last activity", 1_000);
    expect([r.serverText, r.hydratedText, r.liveText]).toEqual(["—", "—", "—"]);
    expect(r.errors).toEqual([]);
  });

  it("an unparseable timestamp shows a dash, not a crash", async () => {
    const r = await serverThenHydrate(contact({ created_at: "not-a-date" }), "Created", 1_000);
    expect([r.serverText, r.hydratedText, r.liveText]).toEqual(["—", "—", "—"]);
    expect(r.errors).toEqual([]);
  });
});
