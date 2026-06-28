// Steps 2/3/4 — first encoded flow against the saucedemo.com sandbox.
//
// saucedemo.com is a public e-commerce site built for browser automation:
// no bot protection, stable `#id` / `data-test` selectors. Login is required
// to browse.
//
// Two flows share the same browse steps but differ in HOW login happens:
//   - `saucedemo`        — automated login from the data box, with fallback.
//   - `saucedemo-manual` — a MANUAL gate: the engine pauses on the login page,
//                          the human logs in by hand (stands in for CAPTCHA/MFA),
//                          then resumes. This mirrors the real CAPTCHA-gated app.

import { type FlowDefinition, type FlowStep } from "./types.js";
import { loginWithFallback } from "../auth/login.js";

const automatedLogin: FlowStep = {
  name: "login",
  description: "log in using the data box (with fallback)",
  run: async (ctx) => {
    const hint = ctx.params.credentialHint;
    await loginWithFallback(
      ctx,
      {
        usernameSelector: "#user-name",
        passwordSelector: "#password",
        submitSelector: "#login-button",
        successUrl: "**/inventory.html",
        failureSelector: '[data-test="error"]',
        dismissErrorSelector: ".error-button",
      },
      typeof hint === "string" ? hint : undefined,
    );
  },
};

const manualLogin: FlowStep = {
  name: "login",
  description: "log in by hand (stands in for a CAPTCHA/MFA gate)",
  manual: true,
  // Runs after resume: confirm the human actually reached the logged-in page.
  run: async ({ page }) => {
    await page.waitForURL("**/inventory.html", { timeout: 5000 });
  },
};

// Steps shared by both flows once authenticated.
const browseSteps: FlowStep[] = [
  {
    name: "add-to-cart",
    description: "add Sauce Labs Backpack to cart",
    run: async ({ page }) => {
      await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    },
  },
  {
    name: "cart",
    description: "open the cart",
    run: async ({ page, log }) => {
      await page.click(".shopping_cart_link");
      await page.waitForURL("**/cart.html");
      const count = await page.locator(".cart_item").count();
      log(`cart contains ${count} item(s)`);
    },
  },
  {
    name: "checkout-address",
    description: "open the checkout information form",
    run: async ({ page }) => {
      await page.click('[data-test="checkout"]');
      await page.waitForURL("**/checkout-step-one.html");
    },
  },
  {
    name: "checkout-payment",
    description: "fill info and reach the order overview",
    run: async ({ page }) => {
      await page.fill("#first-name", "Test");
      await page.fill("#last-name", "Dev");
      await page.fill("#postal-code", "12345");
      await page.click("#continue");
      await page.waitForURL("**/checkout-step-two.html");
    },
  },
];

const targetSteps = ["cart", "checkout-address", "checkout-payment"];

export const saucedemoFlow: FlowDefinition = {
  name: "saucedemo",
  startUrl: "https://www.saucedemo.com/",
  requiresAuth: true,
  steps: [automatedLogin, ...browseSteps],
  targetSteps,
};

export const saucedemoManualFlow: FlowDefinition = {
  name: "saucedemo-manual",
  startUrl: "https://www.saucedemo.com/",
  requiresAuth: true,
  steps: [manualLogin, ...browseSteps],
  targetSteps,
};
