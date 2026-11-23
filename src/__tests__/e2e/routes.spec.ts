/**
 * Every console page draws, by address and by its sidebar link — the walk's `page` steps
 * (`src/desktop/e2ePlan.ts`), judged by the same landmark: the page's heading on screen and its route skeleton gone.
 * The routes come from `CONSOLE_ROUTES`, so a page added to the console is walked here without editing this file.
 */
import { CONSOLE_ROUTES, PAGE_LANDED, PAGE_PENDING } from "../../consoleProfile/plan.js";
import { DOCS_PATH, sidebarLink } from "../../desktop/e2ePlan.js";
import { expect, test } from "./fixtures/test.js";

/** The console pages, the docs excepted: they are a separate layout the viewer step covers. */
const CONSOLE_PAGES = CONSOLE_ROUTES.filter((route) => route.path !== DOCS_PATH);

test("the route list is not empty", () => {
  expect(CONSOLE_PAGES.length).toBeGreaterThan(0);
});

for (const route of CONSOLE_PAGES) {
  test(`${route.path} draws its heading by address, its skeleton gone`, async ({ page }) => {
    await page.goto(route.path);
    await expect(page).toHaveURL(new RegExp(`${route.path}(\\?|$)`));
    await expect(page.locator(PAGE_LANDED).first()).toBeVisible();
    await expect(page.locator(PAGE_PENDING)).toHaveCount(0);
  });
}

test("each sidebar link lands on its page from the one before", async ({ page }) => {
  const sidebar = CONSOLE_PAGES.filter((route) => route.inSidebar);
  expect(sidebar.length).toBeGreaterThan(1);
  await page.goto(sidebar[0]!.path);
  for (const route of sidebar.slice(1)) {
    await page
      .locator(sidebarLink({ path: route.path }))
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`${route.path}(\\?|$)`));
    await expect(page.locator(PAGE_LANDED).first()).toBeVisible();
    await expect(page.locator(PAGE_PENDING)).toHaveCount(0);
  }
});
