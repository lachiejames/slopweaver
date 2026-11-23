/**
 * The in-app viewer: a published local page drawn in its frame under a bar whose back control returns to the Queue —
 * the walk's `pages` step (`src/desktop/e2ePlan.ts`), over the walk's own inert fixture page (`src/desktop/e2eFixture.ts`),
 * which the worker's seed wrote into its home. Reveal in Finder is the desktop shell's alone, so a browser never draws it;
 * the Newer version button is drawn in a browser too.
 */
import { createHash } from "node:crypto";

import { PAGE_LANDED } from "../../consoleProfile/plan.js";
import { FIXTURE_MARKER } from "../../desktop/e2eFixture.js";
import { DOCS_PATH, sidebarLink } from "../../desktop/e2ePlan.js";
import { expect, test } from "./fixtures/test.js";

test("a published page draws in the viewer's frame, and its back control returns to the Queue", async ({
  page,
  console: running,
}) => {
  // A frame in the server's streamed HTML loaded its document once there and again when React moved it into place.
  const documentLoads: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === `/api/page/${running.publishedPage.slug}/index.html`) {
      documentLoads.push(request.url());
    }
  });
  await page.goto(running.publishedPage.viewerPath);
  const frame = page.frameLocator("iframe");
  await expect(frame.locator(`main[${FIXTURE_MARKER}] h1`)).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(1);
  expect(documentLoads).toHaveLength(1);
  const back = page.getByRole("link", { exact: true, name: "Back to the Queue" });
  await back.click();
  await expect(page).toHaveURL(/\/queue(\?|$)/);
});

test("the page-version route names the published page's version: one digest over its one file", async ({
  console: running,
  request,
}) => {
  const { slug, bodySha256 } = running.publishedPage;
  const response = await request.get(`/api/page-version/${slug}`);
  expect(response.status()).toBe(200);
  const version = createHash("sha256").update(`index.html\t${bodySha256}`).digest("hex");
  expect(await response.json()).toEqual({ kind: "version", version });
});

// A real second publish of the fixture would break its remover's one-version contract, so only the version route is
// answered here, with a version the page never had; the route itself is proven against the store just above.
test("a newer version is offered beside the page and loads only on its press", async ({ page, console: running }) => {
  await page.route(`**/api/page-version/${running.publishedPage.slug}`, async (route) => {
    await route.fulfill({ json: { kind: "version", version: "f".repeat(64) } });
  });
  await page.goto(running.publishedPage.viewerPath);
  const newer = page.getByRole("button", { exact: true, name: "Load newer version" });
  await expect(newer).toBeVisible();
  let loads = 0;
  page.on("load", () => {
    loads += 1;
  });
  await expect(page.frameLocator("iframe").locator(`main[${FIXTURE_MARKER}] h1`)).toBeVisible();
  expect(loads).toBe(0);
  await Promise.all([page.waitForEvent("load"), newer.click()]);
  expect(loads).toBe(1);
});

// The frame's document is rewritten to report a version other than the one the viewer read, as a document served
// fresh past its kept window does, and the version route names that same one: the viewer takes the frame's word.
test("the viewer compares republishes against the version its frame reports, not the one it read", async ({
  page,
  console: running,
}) => {
  const { slug, bodySha256 } = running.publishedPage;
  const read = createHash("sha256").update(`index.html\t${bodySha256}`).digest("hex");
  const served = "e".repeat(64);
  await page.route(`**/api/page/${slug}/index.html*`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ body: (await response.text()).replaceAll(read, served), response });
  });
  await page.route(`**/api/page-version/${slug}`, async (route) => {
    await route.fulfill({ json: { kind: "version", version: served } });
  });
  await page.goto(running.publishedPage.viewerPath);
  await expect(page.frameLocator("iframe").locator(`main[${FIXTURE_MARKER}] h1`)).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "Load newer version" })).toHaveCount(0);
});

// A browser follows the docs link in place; only the desktop shell reroutes it into the viewer, a layer-3 proof.
test("the docs link opens the docs page", async ({ page }) => {
  await page.goto("/queue");
  await page
    .locator(sidebarLink({ path: DOCS_PATH }))
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`${DOCS_PATH}(\\?|$)`));
  await expect(page.locator(PAGE_LANDED).first()).toBeVisible();
});
