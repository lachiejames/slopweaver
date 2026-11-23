/**
 * The Settings modal opens from its sidebar button, its Presence tab shows when pressed, and Escape closes it — the
 * walk's `settings` and `settings-presence` steps (`src/desktop/e2ePlan.ts`), by the same selectors.
 */
import { SETTINGS_BUTTON, SETTINGS_NAV, settingsTab } from "../../desktop/e2ePlan.js";
import { expect, test } from "./fixtures/test.js";

test("Settings opens from the sidebar and Escape closes it", async ({ page }) => {
  await page.goto("/queue");
  await page.locator(SETTINGS_BUTTON).click();
  await expect(page.locator(SETTINGS_NAV)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(SETTINGS_NAV)).toHaveCount(0);
});

test("the Presence tab shows when its button is pressed", async ({ page }) => {
  await page.goto("/queue");
  await page.locator(SETTINGS_BUTTON).click();
  const presence = page.locator(settingsTab({ tab: "presence" }));
  await presence.click();
  await expect(presence).toHaveAttribute("aria-current", "true");
});
