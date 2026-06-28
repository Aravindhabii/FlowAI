// Step 2 — flow runner.
// Launches a headed browser, walks a flow's ordered steps up to a named target
// step, then leaves the window open for the developer to take over.

import { chromium, type Browser } from "playwright";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { type FlowContext, type FlowDefinition } from "../flows/types.js";
import { getFlow, listFlows } from "../flows/registry.js";

export interface RunFlowOptions {
  flow: FlowDefinition;
  /** step name to stop at; defaults to the last step. */
  target?: string;
  params?: Record<string, string | number | boolean>;
}

export async function runFlow({
  flow,
  target,
  params = {},
}: RunFlowOptions): Promise<void> {
  const log = (m: string) => console.log(`[FlowAI] ${m}`);

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

  const ctx: FlowContext = { page, params, log };
  for (const step of flow.steps) {
    log(`step "${step.name}"${step.description ? ` — ${step.description}` : ""}`);
    await step.run(ctx);
    if (step.name === stopAt) {
      log(`reached "${stopAt}" at ${page.url()} — the window is yours. Close it to exit.`);
      break;
    }
  }

  // Stay alive until the dev closes the browser.
  await new Promise<void>((resolve) => {
    browser.on("disconnected", () => resolve());
  });
  log("browser closed — exiting.");
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
