/**
 * TILE-69 check for a page a role may not open (PermissionDenied in
 * src/components/patterns/states.tsx). Shared by smoke.spec.ts and its
 * controls in denial-checks.spec.ts, which prove it fails on each case it guards.
 */
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * What only a reader of the pipeline gets: its header and its views. Matched in
 * the whole document, hidden streamed copies included, because a denied role
 * must never be sent it at all.
 */
export const pipelineContent = (page: Page) =>
  page.getByRole("heading", { name: "Pipeline", exact: true, includeHidden: true })
    .or(page.getByText("Every active opportunity has a stage, owner, next action and due date."))
    .or(page.getByText("Missing next action", { exact: true }));

/**
 * Exactly one visible "Not available to <role>" heading, in the page, for
 * exactly this role, and none of `protectedContent` in the document. While a
 * page streams, React parks the content in a hidden `<div hidden id="S:…">`
 * before revealing it, so a hidden denial is not what a person reads and does
 * not count; two visible denials, none, or one naming another role all fail.
 * Call it once the document has loaded, so the protected-content check sees
 * everything the server sent.
 */
export async function expectNotAvailable(page: Page, roleLabel: string, protectedContent: Locator, { timeout }: { timeout?: number } = {}) {
  await expect(page.getByRole("heading", { name: /Not available/ }), "one visible denial").toHaveCount(1, { timeout });
  await expect(page.getByRole("main").getByRole("heading", { name: `Not available to ${roleLabel}`, exact: true }), "the denial names this role").toBeVisible({ timeout });
  // Counted once, not retried: content that was sent and later removed still fails.
  expect(await protectedContent.count(), "no protected content in the document").toBe(0);
}

/**
 * What only a holder of settings.manage gets on /platform/settings
 * (SettingsTabs in src/features/platform/components/settings.tsx), by part, so
 * smoke.spec.ts can show each part is really sent to an administrator. The
 * invite form renders only on ?tab=invites.
 */
export const settingsMarkers = (page: Page) => ({
  header: page.getByRole("heading", { name: "Settings", exact: true, includeHidden: true })
    .or(page.getByText("Users, invitations, role matrix, workspace, locations, opportunity stages, shared views and feature flags.")),
  tabs: page.getByRole("tab", { name: /^(Users|Invites|Roles)$/, includeHidden: true }),
  memberControls: page.getByRole("button", { name: /^(Suspend|Reactivate)$/, includeHidden: true }),
  inviteForm: page.getByRole("button", { name: /^(Invite user|Inviting…)$/, includeHidden: true })
    .or(page.getByText("Sends a Supabase Auth invitation.")),
});

/** Any part of the settings page, hidden streamed copies included (see pipelineContent). */
export const settingsContent = (page: Page) => {
  const { header, tabs, memberControls, inviteForm } = settingsMarkers(page);
  return header.or(tabs).or(memberControls).or(inviteForm);
};
