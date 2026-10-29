// TILE-90: the Projects "Next follow-up" and "Last followed up" relative cells
// must hydrate with the same text the server rendered, then follow the live
// clock. This renders the actual ProjectsView, DataTable and shared formatter
// to HTML at the server's time and hydrates it at a different client time.
// Navigation, query state, session, dialogs, the claim button and explanation
// tooltips are mocked; the table, the cells and the clock are real. It is a
// component-level reproduction, not a whole-browser timing reproduction.
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatRelative } from "@/lib/format";
import type { ProjectListRow } from "@/server/queries/projects";
import { ProjectsView } from "./projects-table";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("nuqs", () => ({ parseAsString: {}, useQueryState: () => [null, vi.fn()] }));
vi.mock("@/components/shell/session-context", () => ({
  useSession: () => ({ session: { userId: "aaaaaaaa-0000-0000-0000-000000000002" }, can: () => true }),
}));
vi.mock("@/features/crm/components/dialogs", () => ({ ProjectOpportunityDialog: () => null }));
// The claim command is mocked; a plain button stands in so the claim cell has a node to keep.
vi.mock("./project-follow-up", () => ({ ClaimProjectButton: () => <button type="button">{"I'll handle this"}</button> }));
vi.mock("@/components/patterns/explain", () => ({
  Gated: ({ children }: { children: React.ReactNode }) => children,
  Hint: ({ children }: { children: React.ReactNode }) => children,
  InfoTip: () => null,
}));

const SERVER_NOW = Date.parse("2026-10-29T08:00:00.000Z");
const SECOND = 1_000;
const at = (ms: number) => new Date(ms).toISOString();
const MEMBERS = [{ user_id: "aaaaaaaa-0000-0000-0000-000000000002", full_name: "Aiman Sales", role_key: "sales_rep" }];

function project(overrides: Partial<ProjectListRow>): ProjectListRow {
  return {
    id: "11111111-0000-4000-8000-000000000090", version: 3, created_by: null, name: "Synthetic hydration project",
    project_type: "residential", status: "planning", area: null, account_id: null, account_name: null,
    contact_id: null, contact_name: null, owner_id: "aaaaaaaa-0000-0000-0000-000000000002",
    expected_completion: null, created_at: at(SERVER_NOW - 86_400_000), opportunities_count: 0,
    next_action: "Synthetic follow-up", next_action_due_at: at(SERVER_NOW - 51 * SECOND),
    last_follow_up_at: at(SERVER_NOW - 51 * SECOND), last_follow_up_by: null,
    ...overrides,
  };
}

/** The cell under a header, located through the real table's header row. */
function cell(container: HTMLElement, header: "Next follow-up" | "Last followed up"): HTMLElement {
  const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
  const index = headers.findIndex((h) => h.startsWith(header));
  expect(index, `column ${header}`).toBeGreaterThanOrEqual(0);
  return container.querySelectorAll<HTMLElement>("tbody tr")[0].querySelectorAll<HTMLElement>("td")[index];
}

const texts = (c: HTMLElement) => ({ next: cell(c, "Next follow-up").textContent, last: cell(c, "Last followed up").textContent });

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame"] });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.useRealTimers();
});

/**
 * Server HTML at `serverNow`, hydrated with the same props at `clientNow`.
 * The browser's first animation frame is held back, so `hydrated` is exactly
 * what the hydration pass produced before any post-mount update.
 */
async function serverThenHydrate(rows: ProjectListRow[], serverNow: number, clientNow: number) {
  const props = { projects: rows, members: MEMBERS, renderedAt: at(serverNow) };
  vi.setSystemTime(serverNow);
  const html = renderToString(<ProjectsView {...props} />);
  container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  const server = texts(container);
  const serverCells = [cell(container, "Next follow-up"), cell(container, "Last followed up")];
  vi.setSystemTime(clientNow);
  const errors: string[] = [];
  await act(async () => {
    root = hydrateRoot(container!, <ProjectsView {...props} />, { onRecoverableError: (e) => errors.push(String((e as Error)?.message ?? e)) });
  });
  const hydrated = texts(container);
  // A mismatch makes React discard the server DOM and render fresh nodes.
  const keptServerNodes = serverCells.every((node) => container!.contains(node));
  return { server, hydrated, errors, keptServerNodes };
}

async function nextFrame() {
  await act(async () => { vi.advanceTimersToNextFrame(); });
}

describe("Projects follow-up cells through hydration (TILE-90)", () => {
  it("control: equal server and client clocks hydrate both cells without a mismatch", async () => {
    const r = await serverThenHydrate([project({})], SERVER_NOW, SERVER_NOW);
    expect(r.server).toEqual({ next: "Synthetic follow-up51 seconds ago", last: "Staff member51 seconds ago" });
    expect(r.errors).toEqual([]);
    expect(r.hydrated).toEqual(r.server);
    expect(r.keptServerNodes).toBe(true);
  });

  it("the original 51 → 52 second drift: both cells hydrate the server text, then show the live 52 seconds", async () => {
    const row = project({});
    const r = await serverThenHydrate([row], SERVER_NOW, SERVER_NOW + 1_000);
    expect(r.server).toEqual({ next: "Synthetic follow-up51 seconds ago", last: "Staff member51 seconds ago" });
    expect(r.errors).toEqual([]);
    expect(r.hydrated).toEqual(r.server);
    expect(r.keptServerNodes).toBe(true);
    await nextFrame();
    expect(texts(container!)).toEqual({ next: "Synthetic follow-up52 seconds ago", last: "Staff member52 seconds ago" });
    expect(texts(container!).next).toBe(`Synthetic follow-up${formatRelative(row.next_action_due_at)}`);
    expect(texts(container!).last).toBe(`Staff member${formatRelative(row.last_follow_up_at)}`);
  });

  // React reports only the first mismatching text in a tree, so each cell is
  // also checked on its own, with the other cell empty.
  it.each([
    ["last_follow_up_at", "Last followed up", { next_action: null, next_action_due_at: null }, "Staff member51 seconds ago", "Staff member52 seconds ago"],
    ["next_action_due_at", "Next follow-up", { last_follow_up_at: null }, "Synthetic follow-up51 seconds ago", "Synthetic follow-up52 seconds ago"],
  ] as const)("%s alone at 51 seconds: equal clocks and a one-second drift both hydrate cleanly", async (_field, header, overrides, serverText, liveText) => {
    for (const drift of [0, 1_000]) {
      const r = await serverThenHydrate([project(overrides)], SERVER_NOW, SERVER_NOW + drift);
      const key = header === "Next follow-up" ? "next" : "last";
      expect(r.server[key], `drift ${drift}`).toBe(serverText);
      expect(r.errors, `drift ${drift}`).toEqual([]);
      expect(r.hydrated[key], `drift ${drift}`).toBe(serverText);
      expect(r.keptServerNodes, `drift ${drift}`).toBe(true);
      await nextFrame();
      expect(cell(container!, header).textContent, `drift ${drift}`).toBe(drift ? liveText : serverText);
      act(() => root?.unmount());
      root = null;
      container?.remove();
    }
  });

  it.each([
    ["client 5 seconds behind", -5_000],
    ["client 2 minutes ahead", 120_000],
    ["client a day ahead", 86_400_000],
  ])("%s: no mismatch, then the live clock with the shared wording", async (_label, drift) => {
    const row = project({ next_action_due_at: at(SERVER_NOW + 3 * 3_600_000), last_follow_up_at: at(SERVER_NOW - 51 * SECOND) });
    const r = await serverThenHydrate([row], SERVER_NOW, SERVER_NOW + drift);
    expect(r.server).toEqual({ next: "Synthetic follow-upin 3 hours", last: "Staff member51 seconds ago" });
    expect(r.errors).toEqual([]);
    expect(r.hydrated).toEqual(r.server);
    expect(r.keptServerNodes).toBe(true);
    await nextFrame();
    expect(texts(container!)).toEqual({
      next: `Synthetic follow-up${formatRelative(row.next_action_due_at)}`,
      last: `Staff member${formatRelative(row.last_follow_up_at)}`,
    });
  });

  it("control: missing dates keep their placeholders through hydration and after mount", async () => {
    const row = project({ next_action: null, next_action_due_at: null, last_follow_up_at: null });
    const r = await serverThenHydrate([row], SERVER_NOW, SERVER_NOW + 1_000);
    expect(r.server).toEqual({ next: "—", last: "Not yet" });
    expect(r.errors).toEqual([]);
    expect(r.hydrated).toEqual(r.server);
    await nextFrame();
    expect(texts(container!)).toEqual({ next: "—", last: "Not yet" });
  });

  it("control: unparseable dates show the shared dash through hydration and after mount", async () => {
    const row = project({ next_action_due_at: "not-a-date", last_follow_up_at: "not-a-date" });
    const r = await serverThenHydrate([row], SERVER_NOW, SERVER_NOW + 1_000);
    expect(r.server).toEqual({ next: "Synthetic follow-up—", last: "Staff member—" });
    expect(r.server.next).toBe(`Synthetic follow-up${formatRelative("not-a-date")}`);
    expect(r.errors).toEqual([]);
    expect(r.hydrated).toEqual(r.server);
    await nextFrame();
    expect(texts(container!)).toEqual(r.server);
  });

  it("updates the time text in place: no cell (or the claim button beside it) is remounted by a clock tick", async () => {
    // An unassigned row renders the claim cell; its button must survive ticks with its pending state and request ID.
    const row = project({ owner_id: null });
    await serverThenHydrate([row], SERVER_NOW, SERVER_NOW + 1_000);
    const cells = container!.querySelectorAll("tbody tr")[0].querySelectorAll("td");
    const before = [...cells].map((td) => [...td.querySelectorAll("*")]);
    await nextFrame();
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(texts(container!).last).toBe("Staff member1 minute ago");
    const after = container!.querySelectorAll("tbody tr")[0].querySelectorAll("td");
    expect([...after]).toEqual([...cells]);
    const claim = container!.querySelector("tbody tr button");
    expect(claim?.textContent).toBe("I'll handle this");
    expect(before.flat()).toContain(claim);
    before.forEach((nodes, i) => nodes.forEach((node) => expect(cells[i].contains(node), `cell ${i} kept ${node.nodeName}`).toBe(true)));
  });

  it("keeps following the browser clock every 30 seconds, and stops when unmounted", async () => {
    const row = project({});
    await serverThenHydrate([row], SERVER_NOW, SERVER_NOW + 1_000);
    await nextFrame();
    expect(texts(container!).last).toBe("Staff member52 seconds ago");
    // Advancing the fake timers also advances the fake Date: 51 s + 1 s + 30 s.
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(texts(container!)).toEqual({
      next: `Synthetic follow-up${formatRelative(row.next_action_due_at)}`,
      last: `Staff member${formatRelative(row.last_follow_up_at)}`,
    });
    expect(texts(container!).last).toBe("Staff member1 minute ago");
    act(() => root!.unmount());
    root = null;
    expect(vi.getTimerCount()).toBe(0);
  });
});
