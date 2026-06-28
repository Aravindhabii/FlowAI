// Step 2 — Flow definition format.
// A flow is an ordered list of named steps. To "go to target X" the runner
// executes steps from the start up to and including the step named X, then
// leaves the browser open. Each step is a deterministic action (a Playwright UI
// interaction now; an API call later in the hybrid engine).

import type { Page } from "playwright";

/** A login credential, e.g. from the data box or typed into the panel. */
export interface Credential {
  username: string;
  password: string;
  label?: string;
}

export interface FlowContext {
  page: Page;
  /** values supplied per-run (e.g. { addons: 2 }); wired to NL params later. */
  params: Record<string, string | number | boolean>;
  log: (message: string) => void;
  /**
   * Ask the human for a credential when automated logins are exhausted (5c).
   * Resolves with a typed credential, or null if the human cancels. Absent in
   * non-interactive contexts (plain CLI), where exhaustion just throws.
   */
  requestCredential?: () => Promise<Credential | null>;
}

export interface FlowStep {
  /** machine name; also usable as a target stop. */
  name: string;
  /** human-readable description for logs. */
  description?: string;
  /**
   * Manual (human-in-the-loop) gate: the engine pauses here, hands the open
   * browser to the human (e.g. to solve a CAPTCHA / log in), and waits for a
   * resume signal before continuing. Used for CAPTCHA/MFA-gated logins.
   */
  manual?: boolean;
  /**
   * The action to perform. Optional for a `manual` step (the human acts
   * instead); when present on a manual step it runs *after* resume — handy for
   * a post-gate assertion like confirming the expected URL.
   */
  run?: (ctx: FlowContext) => Promise<void>;
}

export interface FlowDefinition {
  /** flow id, e.g. "internet". */
  name: string;
  /** page the browser opens on before the first step runs. */
  startUrl: string;
  /** whether this flow needs login (honored in Step 3). */
  requiresAuth?: boolean;
  /** ordered funnel steps. */
  steps: FlowStep[];
  /** subset of step names that are meaningful stop points (for listing/UX). */
  targetSteps: string[];
}

// --- convenience step builders ---------------------------------------------

/** A step that navigates to a fixed URL. */
export function goto(name: string, url: string, description?: string): FlowStep {
  return {
    name,
    description: description ?? `navigate to ${url}`,
    run: async ({ page, log }) => {
      log(`→ ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded" });
    },
  };
}

/** A step that clicks an element. (Used by recorded flows.) */
export function click(name: string, selector: string, description?: string): FlowStep {
  return {
    name,
    description: description ?? `click ${selector}`,
    run: async ({ page }) => {
      await page.click(selector);
    },
  };
}

/**
 * A step that fills an input. `value` may be a literal or a `params` key
 * referenced as "{paramName}".
 */
export function fill(
  name: string,
  selector: string,
  value: string,
  description?: string,
): FlowStep {
  return {
    name,
    description: description ?? `fill ${selector}`,
    run: async ({ page, params }) => {
      const match = /^\{(.+)\}$/.exec(value);
      const resolved = match ? String(params[match[1]] ?? "") : value;
      await page.fill(selector, resolved);
    },
  };
}
