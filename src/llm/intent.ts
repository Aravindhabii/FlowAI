// Step 6a — LLM intent layer (thin brain).
//
// Turns a plain-English request into the structured command the runner already
// accepts: { flow, targetStep, credentialHint }. The local LLM (Ollama) only
// parses + selects; it never drives the browser.
//
// Two safety properties matter:
//  1. The prompt's allowed values AND the validator are built from the SAME
//     registry calls, so they can't drift as flows are added.
//  2. The model's output is validated against the registry. `flow` + `targetStep`
//     are hard-validated (a wrong pick is rejected, never silently run). When
//     Ollama is down or the output is invalid, parseIntent throws — the caller
//     falls back to the deterministic panel form (the structured path).

import { fileURLToPath } from "node:url";
import process from "node:process";
import { getFlow, listFlows } from "../flows/registry.js";

export interface Intent {
  flow: string;
  targetStep: string;
  credentialHint?: string;
}

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3.5:9B";

function buildSystemPrompt(): string {
  const flowLines = listFlows().map((name) => {
    const f = getFlow(name);
    return `  - ${name}: targetSteps = ${f.targetSteps.join(", ")}`;
  });
  return [
    "You translate a developer's request into a JSON command for a browser flow runner.",
    "Respond with ONLY a JSON object — no prose, no markdown fences.",
    "",
    "Available flows and their valid targetStep values:",
    ...flowLines,
    "",
    'Output EXACTLY these keys: {"flow": <flow name>, "targetStep": <one of that flow\'s targetSteps>, "credentialHint": <short label or empty string>}',
    "",
    "Rules:",
    "- flow MUST be exactly one of the listed flow names.",
    "- targetStep MUST be one of the chosen flow's listed targetSteps.",
    "- If the request says to log in by hand / manually, or mentions CAPTCHA, OTP, or MFA, prefer a flow whose name ends in -manual when one exists.",
    "- credentialHint is a short hint at which login to use (e.g. a user type), or an empty string if unspecified.",
  ].join("\n");
}

/** Slice the outermost {...} in case the model wraps the JSON despite format. */
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`no JSON object in model output: ${text.slice(0, 120)}`);
  }
  return JSON.parse(text.slice(start, end + 1));
}

function validate(raw: unknown): Intent {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const flow = String(obj.flow ?? "");
  const targetStep = String(obj.targetStep ?? "");

  const flows = listFlows();
  if (!flows.includes(flow)) {
    throw new Error(`model picked unknown flow "${flow}". Available: ${flows.join(", ")}`);
  }
  const valid = getFlow(flow).targetSteps;
  if (!valid.includes(targetStep)) {
    throw new Error(
      `model picked invalid targetStep "${targetStep}" for flow "${flow}". Valid: ${valid.join(", ")}`,
    );
  }
  // credentialHint is not hard-validated: getLogins() degrades to file order on
  // an unknown label, so a hallucinated hint is harmless.
  const hint =
    typeof obj.credentialHint === "string" && obj.credentialHint.trim()
      ? obj.credentialHint.trim()
      : undefined;
  return { flow, targetStep, credentialHint: hint };
}

export async function parseIntent(command: string): Promise<Intent> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        think: false,
        options: { temperature: 0 },
        format: "json",
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: command },
        ],
      }),
    });
  } catch (err) {
    throw new Error(`Ollama unreachable at ${OLLAMA_URL}: ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new Error(`Ollama returned HTTP ${res.status}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  return validate(extractJson(data.message?.content ?? ""));
}

// CLI: tsx src/llm/intent.ts <natural language command>
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const command = process.argv.slice(2).join(" ");
  if (!command) {
    console.error('usage: tsx src/llm/intent.ts "take me to saucedemo cart as standard"');
    process.exit(1);
  }
  parseIntent(command)
    .then((intent) => console.log(JSON.stringify(intent)))
    .catch((err) => {
      console.error(`[intent] ${(err as Error).message}`);
      process.exit(1);
    });
}
