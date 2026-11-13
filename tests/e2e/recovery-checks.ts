/**
 * TILE-67 checks for a recovery screen: that the redirect to it has landed,
 * who it says is signed in, and that it stays put. Shared by
 * login-recovery.spec.ts and its controls in recovery-checks.spec.ts, which
 * prove each check fails on the case it guards.
 */
import { expect, type Page } from "@playwright/test";

/** The quiet window a settled page must get through without navigating. */
export const QUIET_MS = 2_000;

const SIGNED_IN_AS = /^(Signed in as|Log masuk sebagai) /;

/**
 * Exactly one visible "Signed in as <email>", for exactly this account. While
 * a page streams, React parks the content in a hidden `<div hidden id="S:…">`
 * before revealing it, so hidden matches are not what a person reads and do not
 * count; two visible identities, none, or another account's email all fail.
 */
export async function expectSignedInAs(page: Page, email: string, { timeout }: { timeout?: number } = {}) {
  const identity = page.getByRole("paragraph").filter({ hasText: SIGNED_IN_AS, visible: true });
  await expect(identity, "one visible signed-in identity").toHaveCount(1, { timeout });
  await expect(identity).toHaveText(new RegExp(`${SIGNED_IN_AS.source}${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), { timeout });
  await expect(page.getByText(email, { exact: true }).filter({ visible: true }), "the email is shown once").toHaveCount(1, { timeout });
}

/**
 * The redirect to `url` has landed. Next delivers a redirect raised after the
 * response started streaming — every page here streams, the root providers
 * wrap it in <Suspense> — twice: in the RSC payload, which the client router
 * follows, and as `<meta id="__next-page-redirect" http-equiv="refresh"
 * content="1;url=…">` for a browser without JavaScript. When the router follows
 * it before that tag has streamed in, it lands softly on `url` and the browser
 * still loads `url` once more, a second after the old document's load. That
 * document is the same redirect landing, so it is waited for here; once the
 * tag's document is gone, any navigation is the page moving, which
 * expectStable rejects.
 */
export async function expectLanded(page: Page, url: RegExp) {
  await expect(page).toHaveURL(url);
  // The old document has streamed in full, so a pending tag is in it by now.
  await page.waitForLoadState("load");
  await expect(page.locator("meta#__next-page-redirect"), "the streamed redirect has landed").toHaveCount(0);
  await expect(page).toHaveURL(url);
  await page.waitForLoadState("load");
}

/**
 * The page stays put for QUIET_MS: the main frame neither requests another
 * document (an HTTP, meta-refresh or scripted redirect, or a reload loop) nor
 * moves to another URL (a client-side loop such as /start ⇄ /login). A
 * same-document history update that keeps the URL is not a navigation away:
 * Next's router writes its state into history that way when it hydrates.
 */
export async function expectStable(page: Page) {
  const main = page.mainFrame();
  const url = main.url();
  const moved = page.waitForEvent("framenavigated", { predicate: (f) => f === main && f.url() !== url, timeout: QUIET_MS });
  const loaded = page.waitForEvent("request", { predicate: (r) => r.isNavigationRequest() && r.frame() === main, timeout: QUIET_MS });
  const [move, load] = await Promise.allSettled([moved, loaded]);
  const violations = [
    ...(move.status === "fulfilled" ? [`moved from ${url} to ${move.value.url()}`] : []),
    ...(load.status === "fulfilled" ? [`requested a new document ${load.value.url()}`] : []),
  ];
  for (const r of [move, load]) if (r.status === "rejected" && !/Timeout/.test(String(r.reason))) throw r.reason;
  expect(violations, `stable at ${url}`).toEqual([]);
}
