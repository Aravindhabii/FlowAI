# Dev Flow Jumper — NL-driven session builder for cart/checkout

## Context

While developing the cart & checkout app (Next.js), reaching any working page
means walking the full funnel every time, e.g.:

- Product Description → Plans → Addons → Cart → Checkout (address) → Checkout (payment)
- Internet → Plans → Cart → Checkout

The reason you can't deep-link is that **flow state is server-session-coupled**:
adding a product creates backend records and a UUID, and later steps read
identity that is spread across **the URL, cookies, and the server session**.
Jump straight to checkout and none of that exists, so the page breaks.

**Goal:** type a plain-English command like
*"take me to checkout on the internet flow, logged in as a premium user, with 2 addons"*
and have a tool build the real server session and **hand you a live browser
window already on that page**, so you can keep working.

**Key design decision:** because identity lives across URL + cookie + server
session, it cannot be set from a localhost page (cross-origin). So a deterministic
**Playwright engine launches a headed browser, walks the real flow** (which
naturally creates URL params + cookies + session exactly like production), lands
on the target step, and leaves the window open for you. The **local LLM stays a
thin natural-language brain** — it parses intent and selects/falls-back among
login credentials. It never drives the browser blindly (that would be slow and
flaky for flows that don't actually change).

## Non-goals

- The LLM does **not** click through the UI or "reason" about pages at runtime.
- No catalog/data discovery engine — "different data" is served from a local
  **data box** of labeled test fixtures (logins, payments, addresses, identity)
  with per-category fallback lists (see below).
- Not a production feature; this is a local dev-only tool.

## Architecture

```
┌─────────────────────┐   NL command    ┌──────────────────────┐
│  Local dev panel    │ ───────────────▶│  Intent layer (LLM)  │
│  (localhost web page)│                │  Ollama, small model │
│  text box + logs    │◀── status ──────│  NL → structured plan│
└─────────────────────┘                 └──────────┬───────────┘
                                                    │ {flow, targetStep,
                                                    │  params, credentialHint}
                                                    ▼
                              ┌─────────────────────────────────────┐
                              │  Flow runner (deterministic)        │
                              │  - reads flow from Flow Registry    │
                              │  - Playwright HEADED browser        │
                              │  - hybrid: API calls where stable,  │
                              │    UI clicks for session-building   │
                              │  - login w/ credential + fallback   │
                              │  - lands on target step, LEAVES     │
                              │    the window open for the dev      │
                              └─────────────────────────────────────┘
```

### Components

1. **Local dev panel** — a small localhost web page (plain HTML + tiny
   Express/Fastify server). One text box for the NL command, a log/status stream
   (Server-Sent Events) so you can watch progress. This is only the command surface.

2. **Intent layer (local LLM via Ollama)** — translates NL → a structured plan:
   `{ flow, targetStep, params: { addons: 2, ... }, credentialHint: "premium user" }`.
   Use a small instruct model (e.g. `qwen2.5:7b-instruct` or `llama3.1:8b`) with a
   strict JSON-schema prompt. Also used to (a) match `credentialHint` to an entry
   in the credentials list, and (b) decide to retry with the next credential on a
   login failure. If Ollama is down or returns invalid JSON, fall back to a plain
   structured command syntax so the tool still works.

3. **Flow registry** — the "many but stable" flows, each encoded once as a
   parameterized definition: an ordered list of steps, where each step is either a
   **UI action** (Playwright) or an **API call** (hybrid), plus a `requiresAuth`
   flag (covers "auth depends on flow") and a `targetSteps` map (named stops like
   `cart`, `checkout-address`, `checkout-payment`).

4. **Flow runner (deterministic hybrid engine)** — launches a **headed** Playwright
   browser, executes the flow's steps up to the requested `targetStep`, performs
   login when `requiresAuth`, and **does not close the context** — the dev takes
   over the open window. Session-creating steps go through the real UI/API so URL +
   cookie + server session all get populated correctly.

5. **Data box** — a local, **gitignored** vault (e.g. `databox.json`) holding all
   reusable test fixtures, grouped by category and **labeled**, each as a fallback
   list:
   - `logins`: `[{ label, username, password }]`
   - `payments`: `[{ label, cardNumber, expiry, cvv }]`
   - `addresses`: `[{ label, line1, city, zip, ... }]`
   - `identity`: `[{ label, ssn, dob, ... }]`
   The LLM matches your NL hint (e.g. "premium user", "declined card") to a label;
   the runner uses that entry and **falls back to the next** in the category on
   failure. Persist Playwright `storageState` per `(env, login)` to skip re-login.
   **Guardrail:** test/fake data only (test cards, dummy SSNs) — it lives in
   plaintext on disk, so never put real customer PII here.

> **LLM is lightweight by design.** It only does NL → structured JSON and label
> selection — not page reasoning. A small instruct model (`qwen2.5:3b-instruct`,
> even `1.5b`; `llama3.1:8b` for headroom) runs comfortably on a laptop.

## Tech choices

- **Node + TypeScript**, built in `/Users/abiiaravindhr/Projects/browser`.
- **Playwright** — headed browser + take-over; flows authored via `playwright codegen`.
- **Fastify (or Express)** — serves the dev panel + SSE log stream.
- **Ollama** at `http://localhost:11434` — local LLM, no cloud dependency.

## Proposed project structure

```
browser/
  package.json
  src/
    server.ts            # Fastify: serves panel, /run endpoint, SSE logs
    public/index.html    # the dev panel (text box + log view)
    llm/intent.ts        # Ollama call: NL -> structured plan (JSON schema)
    runner/runFlow.ts    # Playwright engine: walk steps, login+fallback, leave open
    flows/
      registry.ts        # exports all flows
      internet.ts        # example flow definition (steps + targetSteps)
      product-plans.ts   # PDP -> Plans -> Addons -> Cart -> Checkout
    data/
      databox.json       # gitignored: labeled test fixtures (logins/payments/...)
      dataBox.ts         # load + label-match + fallback-list helpers
    auth/
      login.ts           # reusable login step: pulls login from data box,
                         # submits, detects failure, falls back to next entry
  .gitignore             # ignores databox.json, .auth/ storageState
```

## Flow authoring approach (the real maintenance cost)

For each stable flow: run `npx playwright codegen <app-url>`, click through the
funnel once, then **parameterize** the recorded script into a flow definition —
replace hardcoded product/plan/addon values and credentials with params, and mark
named `targetSteps`. This makes "many but stable" flows cheap to add and keeps the
hand-editing minimal.

## Step-by-step implementation (verify at each gate before moving on)

Each step is small and independently testable. We stop and confirm the
**verification** passes before starting the next step.

**Step 0 — Project scaffold.**
Treat `/Users/abiiaravindhr/Projects/browser` as a new standalone project: `git init`,
save this plan into the repo as `PROJECT.md` (living spec), `npm init`, add
TypeScript + Playwright, create the `src/` skeleton.
*Verify:* `PROJECT.md` exists in the repo, `npx tsc --noEmit` passes, and
`npx playwright --version` prints a version.

**Step 1 — Headed browser handoff.**
`runner/runFlow.ts` launches a headed Chromium to the app URL and **leaves it open**.
*Verify:* running the script opens the real app in a window that stays open.

**Step 2 — Encode ONE flow, no login, hardcoded data.**
Record the `internet` flow with `npx playwright codegen`, turn it into a flow
definition (`flows/internet.ts`) with a `targetSteps` map. Runner walks to a chosen
target step. (We'll need the dev/staging **app URL** and one set of working data.)
*Verify:* browser walks the funnel and lands on e.g. `cart` with the cart populated,
window stays open.

**Step 3 — Data box + login (logins only).**
Add `data/databox.json` (gitignored) with a `logins` fallback list, `data/dataBox.ts`
helpers, and `auth/login.ts`. Mark the flow `requiresAuth`.
*Verify:* a flow needing login authenticates and reaches the target. **Fallback test:**
put a bad login first → runner detects failure and retries with the next entry.

**Step 4 — Local web panel (structured command, no LLM yet).**
`server.ts` (Fastify) serves `public/index.html` with a text box + SSE log stream;
a `/run` endpoint takes a **structured** command and invokes the runner.
*Verify:* typing a structured command in the panel runs the flow and streams logs.

**Step 5 — LLM intent layer.**
`llm/intent.ts` calls Ollama to turn NL → `{flow, targetStep, params, dataHint}` JSON;
wire it ahead of `/run`. Keep structured syntax as fallback.
*Verify:* NL command (e.g. *"take me to internet checkout as a premium user"*) produces
the right JSON and lands the browser correctly. **LLM-down test:** stop Ollama → the
structured syntax still works.

**Step 6 — Expand the data box.**
Add `payments`, `addresses`, `identity` categories (test/fake data) and wire them into
the relevant flow steps; LLM matches labels (e.g. "declined card").
*Verify:* a flow consumes a payment/address fixture by label.

**Step 7 — Encode remaining flows + target stops.**
Add the other stable flows via codegen + parameterization; expose `cart`,
`checkout-address`, `checkout-payment` stops.
*Verify:* each flow runs and each target stop lands on the right page.
```
