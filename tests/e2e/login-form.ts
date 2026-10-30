/**
 * TILE-70 sign-in through the password form a person sees. Shared by
 * workspace-entry.spec.ts and its controls in login-form.spec.ts, which prove
 * it fails on each case it guards.
 */
import { expect, type Page } from "@playwright/test";

/**
 * Fills and submits the one visible password sign-in form. While a page
 * streams, React can leave a copy of the form in a hidden `<div hidden id="S:…">`;
 * nobody sees or types into it, so it is not a candidate and is left as it was.
 * Two visible password forms, none, a second visible email or password field,
 * a field or submit button outside the form, or a form whose own password field
 * is hidden or not alone all fail before anything is typed.
 */
export async function submitPasswordForm(page: Page, email: string, password: string) {
  const form = page.locator("form").filter({ has: page.locator("#password"), visible: true });
  await expect(form, "one visible password sign-in form").toHaveCount(1);
  await expect(page.locator("#email").filter({ visible: true }), "one visible email field").toHaveCount(1);
  await expect(page.locator("#password").filter({ visible: true }), "one visible password field").toHaveCount(1);
  const emailField = form.locator("#email");
  const passwordField = form.locator("#password");
  const submit = form.locator("button[type=submit]");
  await expect(emailField, "the email field is in the form").toHaveCount(1);
  await expect(passwordField, "one password field in the form").toHaveCount(1);
  await expect(passwordField, "the password field in the form is visible").toBeVisible();
  await expect(submit, "one submit button in the form").toHaveCount(1);
  await emailField.fill(email);
  await passwordField.fill(password);
  await expect(emailField).toHaveValue(email);
  await expect(passwordField).toHaveValue(password);
  await submit.click();
}
