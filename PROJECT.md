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

**Three roles (who does what):**
- **Human** — does only what a human must: CAPTCHA, OTP/MFA, or any gated step.
- **Deterministic engine** (Playwright + flows + `login.ts`) — walks the funnel
  mechanically, *including automated login where the site allows it*.
- **LLM** — thin brain only: NL → `{flow, targetStep, params, credentialHint}`
  and credential-label selection. Never types or clicks.

**Login is per-flow: automatable OR manual.** Some flows have a plain
username/password form → `login.ts` fills it and auto-falls-back across data-box
entries. Other flows are **CAPTCHA/MFA-gated** → the step is marked `manual`: the
engine drives up to the gate, **pauses and hands you the live browser**, you log
in by hand, then signal continue and the engine resumes to the target. The real
target app is CAPTCHA/MFA-gated, so the manual gate is a core capability, not
optional. The two paths coexist; each flow declares which it uses.

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
   (Server-Sent Events) so you can watch progress, a **Continue** button to resume
   a paused manual gate (CAPTCHA/MFA), and a **credential prompt** shown when every
   data-box login fails so you can type a new one and retry. This is the command
   surface for the human-in-the-loop roles above.

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
   cookie + server session all get populated correctly. A step may be marked
   **`manual`**: the engine pauses there, hands the human the live browser, and
   waits for a **resume** signal (terminal Enter at first, the panel's Continue
   button once the panel exists) before continuing.

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

**Step 2 — Encode ONE flow, no login, hardcoded data. ✅ DONE.**
Encoded against the **saucedemo.com** sandbox (`flows/saucedemo.ts`) instead of the
real app: att.com is bot-protected (403) and the real staging URL isn't reachable
from this machine until the work-laptop move. Flow has a `targetSteps` map
(`cart`, `checkout-address`, `checkout-payment`) and the runner walks to a chosen
target step.
*Verified:* browser walks login → add-to-cart → cart, lands on a populated cart,
window stays open.

**Step 3 — Data box + login (logins only). ✅ DONE.**
Added `data/databox.json` (gitignored), `data/databox.example.json` (committed
template), `data/dataBox.ts` helpers, and `auth/login.ts` (`loginWithFallback`:
selectors passed by the flow, fallback logic in the helper). Flow marked
`requiresAuth`.
*Verified:* the `locked_out_user` entry (placed first) is rejected → runner logs
the failure → retries the next entry → logs in as `standard_user` → reaches cart.

**Step 4 — Manual gate: pause / hand-off / resume.**
The real app's login is CAPTCHA/MFA-gated, so add the human-in-the-loop path. A
flow step can be marked `manual`; the engine drives up to it, **pauses and hands
the human the live browser**, and waits for a **resume** signal before continuing
to the target. Resume comes from the terminal (Enter) for now; the panel's Continue
button replaces it in Step 5. Automated `login.ts` stays for automatable flows —
the two coexist. Test on saucedemo by marking *its* login `manual`.
*Verify:* run the flow → engine opens the browser, pauses with a clear "log in,
then press Enter / continue" message → human logs in by hand → on resume the engine
walks to the target (cart) and hands off. Re-run with automated login still works.

**Step 5 — Local web panel (structured command, no LLM yet). ✅ DONE.**
`server.ts` (Fastify) serves `public/index.html` with a text box + SSE log stream;
`/run` takes the intent schema `{flow, targetStep, params, credentialHint}` and
launches the runner fire-and-forget (single-active-run guard; outcome arrives over
SSE as structured `reached-target`/`error`/`closed` events). The runner was
refactored once to take injected `emit` + `waitForResume` + `requestCredential`
hooks. The **Continue** button (`/resume`) releases a paused manual gate; the
**interactive credential prompt** (`/credential`) appears when every data-box login
fails so a typed credential can be retried.
*Verified (5a/5b/5c):* structured command streams logs + lands on target; second
`/run` → 409, bad flow → 400; manual-gate flow pauses until Continue; exhausting all
logins emits `credential-prompt`, a submitted credential retries to target, cancel
fails cleanly.

**Step 6 — LLM intent layer.** _(6a ✅ DONE · 6b pending)_
`llm/intent.ts` calls Ollama to turn NL → `{flow, targetStep, credentialHint}` JSON;
wire it ahead of `/run`. The deterministic panel form **is** the structured fallback —
no separate text-syntax parser — so when Ollama is down the form still works.

- **6a ✅ DONE.** `src/llm/intent.ts` — `parseIntent(command)` calls Ollama
  (`qwen3.5:9B`, `format:"json"`, `temperature 0`, `think:false`). The system prompt
  **and** the validator are both built from `listFlows()`/`targetSteps` so they can't
  drift; `flow`+`targetStep` are hard-validated against the registry (a wrong pick is
  rejected, never silently run); `credentialHint` is best-effort. Throws cleanly when
  Ollama is unreachable or output is invalid. `OLLAMA_URL`/`OLLAMA_MODEL` env overrides;
  `npm run intent -- "<command>"` CLI.
  *Verified:* standard path → correct JSON; "by hand" → `saucedemo-manual`; nonsense →
  rejected (exit 1); dead Ollama URL → graceful error (exit 1).
- **6b — pending.** Add an NL command box to the panel → server calls `parseIntent` →
  **echo the understood intent** back over SSE → run via the existing `/run`. Keep the
  dropdown+target form as the deterministic fallback.
  *Verify:* an NL command in the panel lands the browser; with Ollama stopped, the form
  path still works.

**Step 7 — Expand the data box.**
Add `payments`, `addresses`, `identity` categories (test/fake data) and wire them into
the relevant flow steps; LLM matches labels (e.g. "declined card").
*Verify:* a flow consumes a payment/address fixture by label.

**Step 8 — Encode remaining flows + target stops.**
Add the other stable flows via codegen + parameterization; expose `cart`,
`checkout-address`, `checkout-payment` stops.
*Verify:* each flow runs and each target stop lands on the right page.

**Step 9 (optional / future) — "Record new flow" button in the dev panel.**
Add a **Record** button to the dev panel that shells out to
`npx playwright codegen <url>`, captures the recorded script, and helps save +
parameterize it into a new `src/flows/*.ts` definition straight from the UI — so
authoring a new flow doesn't require dropping to the terminal. This is the
in-app version of the one-time authoring activity used in Steps 2 and 8.
*Verify:* clicking **Record** opens the codegen recorder; after recording, the
generated flow appears as a draft flow definition that can be reviewed and saved.
