# FlowAI — Worklog

A date-wise log of what was built. The living spec and full step plan live in
[`PROJECT.md`](./PROJECT.md); this file is the "what happened when" view.

Status legend: ✅ done & verified · 🔜 next up

---

## 2026-06-27 — Kickoff & scaffold

- Framed the problem: developing the Next.js cart/checkout app means walking the
  full funnel every time, because flow state is **server-session-coupled** (UUID +
  cookies + server session built up step by step) and can't be deep-linked.
- Decided the architecture: a deterministic **Playwright engine** walks the real
  funnel and hands off an open browser; a **local LLM** stays a thin NL→intent brain
  and never drives the browser; a gitignored **data box** holds labeled test fixtures.
- Wrote the living spec into the repo as `PROJECT.md`; committed the plan.
- **Step 0 — scaffold ✅** Node + TypeScript (ESM/NodeNext) + Playwright, `src/`
  skeleton, `git init`.

## 2026-06-28 — Engine, data box, manual gate, dev panel, intent layer

- **Step 1 — headed handoff ✅** Runner launches a headed Chromium and leaves the
  window open for the developer.
- **Step 2 — first flow ✅** Flow-definition format (`types.ts`) + step builders;
  encoded the **saucedemo.com** sandbox flow (att.com is Akamai bot-protected/403 and
  the real staging URL isn't reachable from this machine until the work-laptop move).
  Named target stops: `cart`, `checkout-address`, `checkout-payment`. Runner walks to
  a chosen target and hands off the open window.
- **Step 3 — data box + login fallback ✅** Gitignored `databox.json` (+ committed
  `databox.example.json`), `dataBox.ts` helpers, and `auth/login.ts`
  (`loginWithFallback` — selectors passed by the flow, fallback logic in the helper).
  Proven by placing `locked_out_user` first: it's rejected → auto-retries
  `standard_user` → reaches the cart.
- **Architecture refinement ✅** Confirmed with the user: the real app's login is
  **CAPTCHA/MFA-gated**. Settled the three roles — **human** does only what a human
  must (CAPTCHA/MFA), the **deterministic engine** walks the funnel (incl. automated
  login where possible), the **LLM** stays a thin brain. Login is **per-flow:
  automatable OR manual**. Updated `PROJECT.md` accordingly.
- **Step 4 — manual gate (pause / hand-off / resume) ✅** A flow step can be marked
  `manual`: the engine pauses, hands over the live browser, and waits for a resume
  signal (terminal Enter / sentinel file at this stage; the panel's Continue button
  replaces it in Step 5). Added a `saucedemo-manual` flow sharing the browse steps.
  Verified: pause → human logs in by hand → resume → walks to the populated cart.
- **Step 5 — local dev panel ✅** Refactored the runner **once** to take injected
  `emit` + `waitForResume` + `requestCredential` hooks and emit structured events.
  - **5a** Fastify server: serves the panel, one SSE log channel, `/run` taking the
    intent schema `{flow, targetStep, params, credentialHint}` fire-and-forget (202;
    outcome over SSE), single-active-run guard (409), bad-flow (400).
  - **5b** **Continue** button → `/resume` releases a paused manual gate.
  - **5c** Interactive **credential prompt** → when every data-box login fails the
    panel asks for one (`/credential`); a submitted credential retries to target,
    cancel fails cleanly.
- **Step 6a — LLM intent layer ✅** `llm/intent.ts`: `parseIntent()` calls Ollama
  (`qwen3.5:9B`, `format:"json"`, `temperature 0`, `think:false`). Prompt + validator
  built from the same registry calls; `flow`/`targetStep` hard-validated; graceful
  failure when Ollama is down → falls back to the deterministic panel form. Verified
  across standard / manual / nonsense / Ollama-down cases.

### 🔜 Next (2026-06-29)
- **Step 6b** — wire the intent layer into the panel (NL command box → `parseIntent`
  → echo understood intent → existing `/run`; keep the form as fallback).
- Then **Step 7** (expand data box: payments/addresses/identity), **Step 8** (remaining
  real flows), **Step 9** (optional "Record new flow" button).
- Eventually re-point at the real app/staging once reachable from the work laptop.
