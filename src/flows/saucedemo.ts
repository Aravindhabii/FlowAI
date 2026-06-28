// Step 2 — first encoded flow against the saucedemo.com sandbox.
//
// saucedemo.com is a public e-commerce site built for browser automation:
// no bot protection, stable `#id` / `data-test` selectors. Login is required
// to browse, so a hardcoded login is included here. Step 3 moves these
// credentials into the data box and adds fallback (saucedemo's `locked_out_user`
// is a ready-made failed-login case).

import { type FlowDefinition } from "./types.js";

const USER = "standard_user";
const PASS = "secret_sauce";

export const saucedemoFlow: FlowDefinition = {
  name: "saucedemo",
  startUrl: "https://www.saucedemo.com/",
  requiresAuth: true,
  steps: [
    {
      name: "login",
      description: `log in as ${USER}`,
      run: async ({ page }) => {
        await page.fill("#user-name", USER);
        await page.fill("#password", PASS);
        await page.click("#login-button");
        await page.waitForURL("**/inventory.html");
      },
    },
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
  ],
  targetSteps: ["cart", "checkout-address", "checkout-payment"],
};
