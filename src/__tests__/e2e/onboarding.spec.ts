/**
 * No first open is sent anywhere: a browser context that has never opened the console lands on the Queue it asked
 * for, and the retired `/setup` address reaches Settings → Models (`site/next.config.mjs`), where a plan connects.
 */
import { PAGE_LANDED } from "../../consoleProfile/plan.js";
import { SETTINGS_NAV, settingsTab } from "../../desktop/e2ePlan.js";
import { expect, LIVE_READ_TIMEOUT_MS, test } from "./fixtures/test.js";

test("a first open of the Queue stays on the Queue", async ({ page }) => {
  await page.goto("/queue");
  // The Queue's own heading, never any page's: an organisation refusal draws an `h1` of its own too.
  await expect(page.locator(PAGE_LANDED, { hasText: /^Queue$/ })).toHaveCount(1, { timeout: LIVE_READ_TIMEOUT_MS });
  await expect(page).toHaveURL(/\/queue(\?|#|$)/);
});

test("the retired /setup address opens Settings on its Models section", async ({ page }) => {
  await page.goto("/setup");
  // The Queue writes its context into the query once it draws (`?context=work`), so the query is allowed, never the hash.
  await expect(page).toHaveURL(/\/queue(\?[^#]*)?#settings\/models$/);
  await expect(page.locator(SETTINGS_NAV)).toBeVisible({ timeout: LIVE_READ_TIMEOUT_MS });
  await expect(page.locator(settingsTab({ tab: "models" }))).toHaveAttribute("aria-current", "true");
});
