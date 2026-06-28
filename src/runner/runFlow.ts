// Steps 2-5 — flow runner.
// Launches a headed browser, walks a flow's ordered steps up to a named target
// step, then leaves the window open for the developer to take over.
//
// The runner is driven by injected hooks so it works the same from the CLI and
// from the web panel (Step 5):
//   - `emit`          receives structured events (log lines + terminal events)
//   - `waitForResume` is how a manual gate is released (terminal/file by
//                     default; the panel injects its Continue-button resolver)

import { chromium, type Browser } from "playwright";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { createInterface } from "node:readline";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type Credential, type FlowContext, type FlowDefinition } from "../flows/types.js";
import { getFlow, listFlows } from "../flows/registry.js";

/** Structured events emitted as a flow runs; the panel renders these. */
export type FlowEvent =
  | { type: "log"; message: string }
  | { type: "manual-gate"; step: string }
  | { type: "credential-prompt"; message: string }
  | { type: "reached-target"; step: string; url: string }
  | { type: "error"; message: string }
  | { type: "closed" };

/** Sentinel file used to resume a paused manual gate when no TTY is attached. */
const RESUME_FILE = join(process.cwd(), ".flowai-resume");

/**
 * Default manual-gate release for CLI use. With a TTY, resume on Enter; without
 * one (background run), resume when the sentinel file appears. The web panel
 * injects its own resolver instead of using this (Step 5b).
 */
function defaultWaitForResume(emit: (e: FlowEvent) => void) {
  return async (): Promise<void> => {
    if (process.stdin.isTTY) {
      await new Promise<void>((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        rl.question("\n>>> Finish in the browser, then press Enter to continue... ", () => {
          rl.close();
          resolve();
        });
      });
      return;
    }
    rmSync(RESUME_FILE, { force: true }); // clear any stale signal
    emit({ type: "log", message: `no TTY — to resume, create the file: ${RESUME_FILE}` });
    while (!existsSync(RESUME_FILE)) {
      await new Promise((r) => setTimeout(r, 500));
    }
    rmSync(RESUME_FILE, { force: true });
  };
}

export interface RunFlowOptions {
  flow: FlowDefinition;
  /** step name to stop at; defaults to the last step. */
  target?: string;
  params?: Record<string, string | number | boolean>;
  /** receives every event; defaults to console logging. */
  emit?: (event: FlowEvent) => void;
  /** releases a manual gate; defaults to terminal/sentinel-file behavior. */
  waitForResume?: (info: { step: string }) => Promise<void>;
  /** asks the human for a credential when logins are exhausted (5c). */
  requestCredential?: () => Promise<Credential | null>;
}

export async function runFlow({
  flow,
  target,
  params = {},
  emit = (e) => {
    if (e.type === "log") console.log(`[FlowAI] ${e.message}`);
  },
  waitForResume,
  requestCredential,
}: RunFlowOptions): Promise<void> {
  const log = (m: string) => emit({ type: "log", message: m });
  const resume = waitForResume ?? defaultWaitForResume(emit);

  const stopAt = target ?? flow.steps[flow.steps.length - 1]?.name;
  if (!stopAt || !flow.steps.some((s) => s.name === stopAt)) {
    const names = flow.steps.map((s) => s.name).join(", ");
    throw new Error(
      `Flow "${flow.name}" has no step named "${stopAt}". Steps: ${names}`,
    );
  }

  log(`flow "${flow.name}" → stop at "${stopAt}"`);
  const browser: Browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  log(`opening ${flow.startUrl}`);
  await page.goto(flow.startUrl, { waitUntil: "domcontentloaded" });

  const ctx: FlowContext = { page, params, log, requestCredential };
  for (const step of flow.steps) {
    log(`step "${step.name}"${step.description ? ` — ${step.description}` : ""}`);
    if (step.manual) {
      log(`⏸ manual gate — complete this in the open browser window now.`);
      emit({ type: "manual-gate", step: step.name });
      await resume({ step: step.name });
      log(`▶ resumed`);
    }
    if (step.run) {
      await step.run(ctx);
    }
    if (step.name === stopAt) {
      log(`reached "${stopAt}" at ${page.url()} — the window is yours. Close it to exit.`);
      emit({ type: "reached-target", step: stopAt, url: page.url() });
      break;
    }
  }

  // Stay alive until the dev closes the browser.
  await new Promise<void>((resolve) => {
    browser.on("disconnected", () => resolve());
  });
  log("browser closed — exiting.");
  emit({ type: "closed" });
}

// CLI: tsx src/runner/runFlow.ts <flowName> [targetStep]
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const flowName = process.argv[2] ?? "saucedemo";
  const target = process.argv[3];
  let flow: FlowDefinition;
  try {
    flow = getFlow(flowName);
  } catch (err) {
    console.error(`[FlowAI] ${(err as Error).message}`);
    console.error(`[FlowAI] available flows: ${listFlows().join(", ")}`);
    process.exit(1);
  }
  runFlow({ flow, target }).catch((err) => {
    console.error("[FlowAI] failed:", err);
    process.exit(1);
  });
}
