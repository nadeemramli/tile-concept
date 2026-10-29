/**
 * Server render → hydrate the real TasksClient, DataTable and format helpers
 * with the server and browser clocks controlled separately. CI run 40872878683
 * (job 123444170298, commit 2aebc61) failed on exactly this: the Due cell moved
 * from "2 minutes ago" to "3 minutes ago" between the server render and
 * hydration of /sales/tasks. Only routing, URL state, session and the server
 * actions are stubbed.
 */
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { formatDateTime } from "@/lib/format";
import type { TaskRow } from "@/features/tasks/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("nuqs", () => ({ useQueryState: () => [null, vi.fn()] }));
vi.mock("@/components/shell/session-context", () => {
  const permissions = new Set(["sales.read", "sales.write"]);
  return { useSession: () => ({ session: { userId: "u-1", roleLabel: "Sales representative" }, permissions, can: (p: string) => permissions.has(p) }) };
});
vi.mock("@/server/commands/tasks", () => ({
  cancelTaskAction: vi.fn(),
  completeTaskAction: vi.fn(),
  createTaskAction: vi.fn(),
  reopenTaskAction: vi.fn(),
  updateTaskAction: vi.fn(),
}));

const { TasksClient } = await import("./tasks-client");

// Tell React this is a test environment so act() does not warn; every other
// console.error during hydration is collected and fails the test.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SERVER_NOW = Date.parse("2026-10-29T08:00:00.000Z");
const at = (offsetMs: number) => new Date(SERVER_NOW + offsetMs).toISOString();
const MINUTE = 60_000;
const OVERDUE = "text-destructive";

function task(overrides: Partial<TaskRow>): TaskRow {
  return {
    id: "t-1", title: "Synthetic follow-up", description: null, status: "open", priority: "normal", due_at: at(-149_500),
    assignee_id: "u-1", assignee_name: "Synthetic Rep", created_by: "u-1", contact_id: null, contact_name: null, account_id: null,
    opportunity_id: null, opportunity_name: null, lead_id: null, project_id: null, completed_at: null, outcome: null,
    created_at: at(-3 * 86_400_000), ...overrides,
  };
}

function view(row: TaskRow) {
  // renderedAt is the server's request time, passed down by the page. The
  // tooltip provider normally comes from the app shell (src/app/providers.tsx).
  return (
    <TooltipProvider delayDuration={200}>
      <TasksClient view="all" tasks={[row]} counts={{ mine: 1, overdue: 0, open: 1, doneWeek: 0 }} members={[]} prefill={{}} renderedAt={new Date(SERVER_NOW).toISOString()} />
    </TooltipProvider>
  );
}

interface DueCell { text: string; className: string; title: string | null }

function dueCell(container: HTMLElement): DueCell {
  const headers = Array.from(container.querySelectorAll("thead th")).map((th) => th.textContent ?? "");
  const index = headers.findIndex((text) => text.startsWith("Due"));
  expect(index, "Due column").toBeGreaterThanOrEqual(0);
  const td = container.querySelectorAll("tbody tr")[0].querySelectorAll("td")[index];
  const span = td.querySelector("span");
  return { text: td.textContent ?? "", className: span?.className ?? "", title: span?.getAttribute("title") ?? null };
}

interface Hydrated { server: DueCell; hydrated: DueCell; live: DueCell; errors: string[]; container: HTMLElement }
let root: Root | null = null;

/** Server-renders at SERVER_NOW, hydrates `skewMs` later, then lets mount effects run. */
async function serverThenHydrate(row: TaskRow, skewMs: number): Promise<Hydrated> {
  vi.setSystemTime(SERVER_NOW);
  const html = renderToString(view(row));
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  const server = dueCell(container);

  vi.setSystemTime(SERVER_NOW + skewMs);
  const errors: string[] = [];
  const consoleError = vi.spyOn(console, "error").mockImplementation((...args) => errors.push(String(args[0])));
  await act(async () => {
    root = hydrateRoot(container, view(row), { onRecoverableError: (error) => errors.push(String((error as Error).message ?? error)) });
  });
  const hydrated = dueCell(container);
  // Mount effects (requestAnimationFrame) move the labels onto the live clock.
  await act(async () => {
    vi.advanceTimersToNextFrame();
  });
  const live = dueCell(container);
  consoleError.mockRestore();
  return { server, hydrated, live, errors, container };
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

describe("Tasks Due cell: server render and hydration agree", () => {
  it("same clock: 2 minutes ago, overdue, no hydration error (control)", async () => {
    const r = await serverThenHydrate(task({}), 0);
    expect(r.errors).toEqual([]);
    expect(r.server.text).toBe("2 minutes ago");
    expect(r.hydrated).toEqual(r.server);
    expect(r.live.className).toContain(OVERDUE);
  });

  it("browser clock 1000 ms ahead across 2 → 3 minutes: same text at hydration, current text after mount", async () => {
    const r = await serverThenHydrate(task({ due_at: at(-149_500) }), 1_000);
    expect(r.errors).toEqual([]);
    expect(r.server.text).toBe("2 minutes ago");
    expect(r.hydrated.text).toBe("2 minutes ago");
    expect(r.live.text).toBe("3 minutes ago");
  });

  it("due-time boundary: due 500 ms after the server render, overdue once the browser clock passes it", async () => {
    const r = await serverThenHydrate(task({ due_at: at(500) }), 1_000);
    expect(r.errors).toEqual([]);
    expect(r.server.text).toBe("just now");
    expect(r.server.className).not.toContain(OVERDUE);
    expect(r.hydrated.className).toBe(r.server.className);
    expect(r.live.text).toBe("just now");
    expect(r.live.className).toContain(OVERDUE);
  });

  it("a browser clock 10 minutes ahead hydrates cleanly, then shows the browser's relative time", async () => {
    const r = await serverThenHydrate(task({ due_at: at(30 * MINUTE) }), 10 * MINUTE);
    expect(r.errors).toEqual([]);
    expect(r.server.text).toBe("in 30 minutes");
    expect(r.hydrated.text).toBe("in 30 minutes");
    expect(r.live.text).toBe("in 20 minutes");
    expect(r.live.className).not.toContain(OVERDUE);
  });

  it("keeps the full absolute due time as the title, before and after mount", async () => {
    const due = at(-149_500);
    const r = await serverThenHydrate(task({ due_at: due }), 1_000);
    expect(r.server.title).toBe(formatDateTime(due));
    expect(r.hydrated.title).toBe(formatDateTime(due));
    expect(r.live.title).toBe(formatDateTime(due));
  });

  it("keeps following the live clock after mount", async () => {
    const r = await serverThenHydrate(task({ due_at: at(-149_500) }), 1_000);
    expect(r.live.text).toBe("3 minutes ago");
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(dueCell(r.container).text).toBe("4 minutes ago");
  });
});

describe("Tasks Due cell: existing overdue semantics", () => {
  it.each(["done", "cancelled"])("a %s task past its due time is never shown as overdue", async (status) => {
    const r = await serverThenHydrate(task({ status, due_at: at(-149_500), completed_at: status === "done" ? at(-MINUTE) : null }), 1_000);
    expect(r.errors).toEqual([]);
    expect(r.hydrated.text).toBe("2 minutes ago");
    expect(r.live.text).toBe("3 minutes ago");
    for (const cell of [r.server, r.hydrated, r.live]) expect(cell.className).not.toContain(OVERDUE);
  });

  it("an open task due later is not overdue", async () => {
    const r = await serverThenHydrate(task({ due_at: at(2 * 86_400_000) }), 1_000);
    expect(r.errors).toEqual([]);
    expect(r.live.text).toBe("in 2 days");
    expect(r.live.className).not.toContain(OVERDUE);
  });

  it("a task without a due date shows a dash, before and after mount", async () => {
    const r = await serverThenHydrate(task({ due_at: null }), 1_000);
    expect(r.errors).toEqual([]);
    expect([r.server.text, r.hydrated.text, r.live.text]).toEqual(["—", "—", "—"]);
    expect(r.live.title).toBeNull();
  });
});
