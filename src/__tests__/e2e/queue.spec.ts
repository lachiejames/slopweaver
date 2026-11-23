/**
 * The Queue draws the seeded GitHub landing reading as rows, and a row opens its card — the walk's `queue-card` step
 * (`src/cli/commands/desktop/e2eQueueCard.ts`), against a reading this run recorded rather than whatever the owner's
 * GitHub holds today, so an empty Queue can never pass it as "not applicable".
 */
import { QUEUE_ROW } from "../../desktop/e2ePlan.js";
import { expect, LIVE_READ_TIMEOUT_MS, test } from "./fixtures/test.js";

test("the Queue draws the seeded landing reading's pull requests as rows", async ({ page }) => {
  await page.goto("/queue");
  await expect(page.locator(QUEUE_ROW).first()).toBeVisible({ timeout: LIVE_READ_TIMEOUT_MS });
});

test("a Queue row opens its card's dialog, and Escape closes it", async ({ page }) => {
  await page.goto("/queue");
  const row = page.locator(QUEUE_ROW).first();
  await expect(row).toBeVisible({ timeout: LIVE_READ_TIMEOUT_MS });
  await row.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
