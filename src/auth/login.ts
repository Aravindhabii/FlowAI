// Step 3 — reusable login step with credential fallback.
//
// Selectors and success/failure signals are app-specific, so the flow passes a
// `LoginForm` descriptor. The fallback logic lives here: pull logins from the
// data box (optionally prioritized by a credential hint/label), try each in
// order, and on failure dismiss the error and retry the next entry.

import { type Page } from "playwright";
import { type FlowContext } from "../flows/types.js";
import { getLogins, type Login } from "../data/dataBox.js";

export interface LoginForm {
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  /** URL glob that indicates a successful login. */
  successUrl: string;
  /** selector that becomes visible when a login is rejected. */
  failureSelector: string;
  /** optional selector to click to clear a rejection before retrying. */
  dismissErrorSelector?: string;
  /** max ms to wait for success-or-failure per attempt (default 8000). */
  timeoutMs?: number;
}

export async function loginWithFallback(
  ctx: FlowContext,
  form: LoginForm,
  credentialHint?: string,
): Promise<Login> {
  const { page, log } = ctx;
  const candidates = getLogins(credentialHint);
  const timeout = form.timeoutMs ?? 8000;

  for (const cred of candidates) {
    log(`trying login "${cred.label}" (${cred.username})`);
    await page.fill(form.usernameSelector, cred.username);
    await page.fill(form.passwordSelector, cred.password);
    await page.click(form.submitSelector);

    if ((await waitForOutcome(page, form, timeout)) === "success") {
      log(`login succeeded as "${cred.label}"`);
      return cred;
    }

    log(`login failed for "${cred.label}" → trying next credential`);
    await dismissError(page, form);
  }

  throw new Error(
    `All ${candidates.length} login(s) failed — check src/data/databox.json.`,
  );
}

// Bounds the wait on a settled state, then asserts state explicitly. Both
// branches carry rejection handlers so the loser can't dangle as an
// unhandled rejection once the race resolves.
async function waitForOutcome(
  page: Page,
  form: LoginForm,
  timeout: number,
): Promise<"success" | "failure"> {
  const errorLoc = page.locator(form.failureSelector);

  const success = page
    .waitForURL(form.successUrl, { timeout })
    .then(() => "success" as const, () => null);
  const failure = errorLoc
    .waitFor({ state: "visible", timeout })
    .then(() => "failure" as const, () => null);

  await Promise.race([success, failure]);

  if (await errorLoc.isVisible().catch(() => false)) return "failure";
  const onSuccess = await page
    .waitForURL(form.successUrl, { timeout: 1000 })
    .then(() => true, () => false);
  return onSuccess ? "success" : "failure";
}

// Clear a rejection so the next attempt's failure check starts clean.
async function dismissError(page: Page, form: LoginForm): Promise<void> {
  if (!form.dismissErrorSelector) return;
  await page.click(form.dismissErrorSelector).catch(() => {});
  await page
    .locator(form.failureSelector)
    .waitFor({ state: "hidden", timeout: 2000 })
    .catch(() => {});
}
