// Step 2 — Flow definition format.
// A flow is an ordered list of named steps. To "go to target X" the runner
// executes steps from the start up to and including the step named X, then
// leaves the browser open. Each step is a deterministic action (a Playwright UI
// interaction now; an API call later in the hybrid engine).

import type { Page } from "playwright";

export interface FlowContext {
  page: Page;
  /** values supplied per-run (e.g. { addons: 2 }); wired to NL params later. */
  params: Record<string, string | number | boolean>;
  log: (message: string) => void;
}

export interface FlowStep {
  /** machine name; also usable as a target stop. */
  name: string;
  /** human-readable description for logs. */
  description?: string;
  /** the action to perform. */
  run: (ctx: FlowContext) => Promise<void>;
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
