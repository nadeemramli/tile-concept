/**
 * TILE-68: the badge's age ("42 minutes ago") and tone are clock-relative. The
 * server rendered one minute and the browser hydrated the next, and React threw
 * away the tree with a hydration mismatch (Stock management, CI 40795076979).
 * These tests render the real badge on the server, move the clock, and hydrate
 * it in jsdom, the way a page load does.
 */
import { act } from "react";
import { renderToString } from "react-dom/server";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClockProvider, CLOCK_TICK_MS } from "@/components/patterns/clock";
import { FreshnessBadge, freshnessOf } from "@/components/patterns/freshness-badge";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T = Date.parse("2026-10-29T00:00:00Z");
const MIN = 60_000;
const ago = (ms: number) => new Date(T - ms).toISOString();

type Badge = { lastSuccessAt: string | null; slaMinutes: number };
type Rendered = { container: HTMLElement; root: Root; serverHtml: string; errors: string[]; unmount: () => void };

const mounted: Rendered[] = [];
afterEach(() => {
  mounted.splice(0).forEach((r) => r.unmount());
  vi.useRealTimers();
});

/**
 * Server-render at `serverAt` (the request's clock, handed to ClockProvider
 * unless `providerNow` overrides it), then hydrate with the browser clock at
 * `clientAt`. Every hydration warning or recovery is collected.
 */
function serverThenHydrate(props: Badge | Badge[], { serverAt, clientAt, provider = true, providerNow }: { serverAt: number; clientAt: number; provider?: boolean; providerNow?: number }) {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(serverAt);
  const ui = (now: number) => {
    const badge = [props].flat().map((p, i) => <FreshnessBadge key={i} {...p} />);
    return <TooltipProvider>{provider ? <ClockProvider now={now}>{badge}</ClockProvider> : badge}</TooltipProvider>;
  };
  const serverHtml = renderToString(ui(serverAt));
  const container = document.createElement("div");
  container.innerHTML = serverHtml;
  document.body.append(container);

  vi.setSystemTime(clientAt);
  const errors: string[] = [];
  const consoleError = vi.spyOn(console, "error").mockImplementation((...args) => errors.push(args.map(String).join(" ")));
  let root!: Root;
  act(() => {
    root = hydrateRoot(container, ui(providerNow ?? serverAt), { onRecoverableError: (e) => errors.push(`recoverable: ${(e as Error).message}`) });
  });
  consoleError.mockRestore();
  const rendered = {
    container,
    root,
    serverHtml,
    errors,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
  mounted.push(rendered);
  return rendered;
}

const badges = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>("[data-freshness]"));
const only = (c: HTMLElement) => {
  const all = badges(c);
  expect(all).toHaveLength(1);
  return all[0];
};
const serverBadge = (html: string) => {
  const c = document.createElement("div");
  c.innerHTML = html;
  return only(c);
};

describe("freshnessOf", () => {
  it("keeps the SLA policy: fresh to the SLA, aging to three times it, then stale", () => {
    const sla = 240;
    expect(freshnessOf(null, sla, T)).toBe("unknown");
    expect(freshnessOf(undefined, sla, T)).toBe("unknown");
    expect(freshnessOf(ago(sla * MIN), sla, T)).toBe("fresh");
    expect(freshnessOf(ago(sla * MIN + 1), sla, T)).toBe("aging");
    expect(freshnessOf(ago(3 * sla * MIN), sla, T)).toBe("aging");
    expect(freshnessOf(ago(3 * sla * MIN + 1), sla, T)).toBe("stale");
  });
});

describe("FreshnessBadge hydration (TILE-68)", () => {
  it("hydrates the server's label when the browser clock has crossed the next minute, then shows the browser's", () => {
    // The CI failure: 42 minutes on the server, 43 in the browser.
    const r = serverThenHydrate({ lastSuccessAt: ago(42 * MIN), slaMinutes: 240 }, { serverAt: T, clientAt: T + MIN });
    expect(serverBadge(r.serverHtml)).toHaveTextContent("42 minutes ago");
    expect(r.errors).toEqual([]);
    expect(only(r.container)).toHaveTextContent("43 minutes ago");
    expect(only(r.container)).toHaveAttribute("data-freshness", "fresh");
  });

  it("agrees with the same clock on both sides", () => {
    const r = serverThenHydrate({ lastSuccessAt: ago(42 * MIN), slaMinutes: 240 }, { serverAt: T, clientAt: T });
    expect(r.errors).toEqual([]);
    expect(only(r.container)).toHaveTextContent("42 minutes ago");
  });

  it("is sensitive: two different clocks at hydration are reported (negative control)", () => {
    // What the parent did: server and browser each read their own clock.
    // Proves this harness sees the mismatch the fix removes.
    const r = serverThenHydrate({ lastSuccessAt: ago(42 * MIN), slaMinutes: 240 }, { serverAt: T, clientAt: T + MIN, providerNow: T + MIN });
    expect(r.errors.some((e) => /hydrat/i.test(e))).toBe(true);
  });

  it.each([
    { name: "fresh → aging at the SLA", age: 240 * MIN, from: "fresh", to: "aging" },
    { name: "aging → stale at three times the SLA", age: 720 * MIN, from: "aging", to: "stale" },
  ])("hydrates the server's tone across $name, then advances", ({ age, from, to }) => {
    const r = serverThenHydrate({ lastSuccessAt: ago(age), slaMinutes: 240 }, { serverAt: T, clientAt: T + MIN });
    expect(serverBadge(r.serverHtml)).toHaveAttribute("data-freshness", from);
    expect(r.errors).toEqual([]);
    expect(only(r.container)).toHaveAttribute("data-freshness", to);
  });

  it("crosses the 'just now' boundary without a mismatch", () => {
    const r = serverThenHydrate({ lastSuccessAt: ago(30_000), slaMinutes: 240 }, { serverAt: T, clientAt: T + 30_000 });
    expect(serverBadge(r.serverHtml)).toHaveTextContent("just now");
    expect(r.errors).toEqual([]);
    expect(only(r.container)).toHaveTextContent("1 minute ago");
  });

  it("keeps an unknown source distinct and unchanged by time", () => {
    const r = serverThenHydrate({ lastSuccessAt: null, slaMinutes: 240 }, { serverAt: T, clientAt: T + 600 * MIN });
    expect(serverBadge(r.serverHtml)).toHaveTextContent("never");
    expect(r.errors).toEqual([]);
    expect(only(r.container)).toHaveTextContent("never");
    expect(only(r.container)).toHaveAttribute("data-freshness", "unknown");
  });

  it("advances after hydration and stops its ticker when the last badge unmounts", () => {
    const r = serverThenHydrate({ lastSuccessAt: ago(42 * MIN), slaMinutes: 60 }, { serverAt: T, clientAt: T });
    expect(only(r.container)).toHaveTextContent("42 minutes ago");
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(2 * MIN));
    expect(only(r.container)).toHaveTextContent("44 minutes ago");
    act(() => vi.advanceTimersByTime(17 * MIN));
    expect(only(r.container)).toHaveTextContent("1 hour ago");
    expect(only(r.container)).toHaveAttribute("data-freshness", "aging");
    expect(r.errors).toEqual([]);
    mounted.splice(mounted.indexOf(r), 1);
    r.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares one ticker between badges, which advance together", () => {
    const r = serverThenHydrate(
      [
        { lastSuccessAt: ago(5 * MIN), slaMinutes: 240 },
        { lastSuccessAt: ago(10 * MIN), slaMinutes: 240 },
      ],
      { serverAt: T, clientAt: T },
    );
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(CLOCK_TICK_MS * 2));
    expect(badges(r.container).map((b) => b.textContent)).toEqual(["6 minutes ago", "11 minutes ago"]);
    expect(r.errors).toEqual([]);
  });

  it("without a ClockProvider, renders a clock-free label for SSR and hydration, then the age", () => {
    const r = serverThenHydrate({ lastSuccessAt: ago(42 * MIN), slaMinutes: 240 }, { serverAt: T, clientAt: T + MIN, provider: false });
    const ssr = serverBadge(r.serverHtml);
    expect(ssr).toHaveAttribute("data-freshness", "pending");
    expect(ssr.textContent).not.toMatch(/ago|never/);
    expect(r.errors).toEqual([]);
    expect(only(r.container)).toHaveTextContent("43 minutes ago");
    expect(only(r.container)).toHaveAttribute("data-freshness", "fresh");
  });

  it("mounts on the client (soft navigation) with the browser's clock", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(T);
    const container = document.createElement("div");
    document.body.append(container);
    const errors: string[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation((...args) => errors.push(args.map(String).join(" ")));
    const root = createRoot(container);
    act(() => {
      root.render(
        <TooltipProvider>
          {/* A stale provider value (from the first page load) is not used for client mounts. */}
          <ClockProvider now={T - 600 * MIN}>
            <FreshnessBadge lastSuccessAt={ago(42 * MIN)} slaMinutes={240} />
          </ClockProvider>
        </TooltipProvider>,
      );
    });
    consoleError.mockRestore();
    expect(errors).toEqual([]);
    expect(only(container)).toHaveTextContent("42 minutes ago");
    act(() => root.unmount());
    container.remove();
  });
});
