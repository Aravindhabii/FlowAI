// Step 2 — flow registry. All encoded flows are looked up here by name.

import { type FlowDefinition } from "./types.js";
import { saucedemoFlow } from "./saucedemo.js";

export const flows: Record<string, FlowDefinition> = {
  [saucedemoFlow.name]: saucedemoFlow,
};

export function getFlow(name: string): FlowDefinition {
  const flow = flows[name];
  if (!flow) {
    const available = Object.keys(flows).join(", ") || "(none)";
    throw new Error(`Unknown flow "${name}". Available: ${available}`);
  }
  return flow;
}

export function listFlows(): string[] {
  return Object.keys(flows);
}
