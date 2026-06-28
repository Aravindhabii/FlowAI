// Step 5a — local dev panel server.
//
// Serves a one-box panel, streams flow events over SSE, and exposes a /run
// endpoint that takes the intent schema { flow, targetStep, params,
// credentialHint } and launches the runner fire-and-forget. The browser the
// runner opens stays alive because this process holds the reference.
//
// 5a scope: structured command + live logs, automated flows only. The manual-
// gate Continue button (5b) and the all-logins-failed credential prompt (5c)
// build on the same SSE channel next.

import Fastify, { type FastifyReply } from "fastify";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runFlow, type FlowEvent } from "./runner/runFlow.js";
import { getFlow, listFlows } from "./flows/registry.js";
import { type Credential } from "./flows/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5179);

const app = Fastify();

// --- SSE: one channel, broadcast to every connected panel ------------------
const clients = new Set<FastifyReply>();

function broadcast(event: FlowEvent): void {
  if (event.type === "log") console.log(`[FlowAI] ${event.message}`);
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const reply of clients) reply.raw.write(payload);
}

app.get("/events", (req, reply) => {
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  reply.raw.write("retry: 2000\n\n");
  clients.add(reply);
  req.raw.on("close", () => clients.delete(reply));
});

// --- single active run guard -----------------------------------------------
let running = false;

// Resolver for a paused manual gate; set while the runner waits, cleared on
// resume. The Continue button (POST /resume) calls it. Replaces the CLI's
// terminal/file resume when a flow is launched from the panel.
let pendingResume: (() => void) | null = null;

app.post("/resume", async (req, reply) => {
  if (!pendingResume) {
    return reply.code(409).send({ error: "No manual gate is waiting." });
  }
  const resolve = pendingResume;
  pendingResume = null;
  resolve();
  return reply.send({ status: "resumed" });
});

// Resolver for an interactive credential request; set while login is exhausted
// and waiting for the human to type one. POST /credential answers it (5c).
let pendingCredential: ((cred: Credential | null) => void) | null = null;

app.post("/credential", async (req, reply) => {
  if (!pendingCredential) {
    return reply.code(409).send({ error: "No credential is being requested." });
  }
  const body = (req.body ?? {}) as Partial<Credential> & { cancel?: boolean };
  const resolve = pendingCredential;
  pendingCredential = null;
  if (body.cancel || !body.username || !body.password) {
    resolve(null); // treated as cancel
  } else {
    resolve({ username: body.username, password: body.password, label: body.label });
  }
  return reply.send({ status: "ok" });
});

interface RunBody {
  flow?: string;
  targetStep?: string;
  params?: Record<string, string | number | boolean>;
  credentialHint?: string;
}

app.post("/run", async (req, reply) => {
  if (running) {
    return reply.code(409).send({ error: "A flow is already running." });
  }
  const body = (req.body ?? {}) as RunBody;
  const flowName = body.flow ?? "";
  let flow;
  try {
    flow = getFlow(flowName);
  } catch (err) {
    return reply
      .code(400)
      .send({ error: (err as Error).message, available: listFlows() });
  }

  running = true;
  const params = { ...(body.params ?? {}) };
  if (body.credentialHint) params.credentialHint = body.credentialHint;

  // Fire-and-forget: the request returns now; progress and the terminal
  // outcome (reached-target / error / closed) arrive over SSE. A manual gate
  // parks its resolver in `pendingResume` until POST /resume fires.
  runFlow({
    flow,
    target: body.targetStep,
    params,
    emit: broadcast,
    waitForResume: () => new Promise<void>((resolve) => {
      pendingResume = resolve;
    }),
    requestCredential: () => new Promise<Credential | null>((resolve) => {
      pendingCredential = resolve;
      broadcast({
        type: "credential-prompt",
        message: "All data-box logins failed — enter a working credential to retry.",
      });
    }),
  })
    .catch((err) => broadcast({ type: "error", message: (err as Error).message }))
    .finally(() => {
      running = false;
      pendingResume = null;
      pendingCredential = null;
    });

  return reply.code(202).send({ status: "started", flow: flow.name });
});

// --- panel + flow list ------------------------------------------------------
app.get("/flows", async () => ({ flows: listFlows() }));

app.get("/", async (req, reply) => {
  const html = readFileSync(join(here, "public", "index.html"), "utf8");
  return reply.type("text/html").send(html);
});

app.listen({ port: PORT }).then(() => {
  console.log(`[FlowAI] dev panel on http://localhost:${PORT}`);
});
