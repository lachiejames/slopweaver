/**
 * The fixture page's effectful half: published through the REAL publisher, so the store holds it exactly as it holds
 * a page of the owner's, and taken back out after the walk by the store's narrow fixture remover. A publish writes
 * nothing on disk, so there is nothing else to remove. `slopweaver desktop e2e` and the console's browser lane
 * (`src/__tests__/e2e/`) both use it, so the viewer each one opens is served a page the product published rather than
 * a file a test wrote.
 */
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { productionPublishPage } from "../pages/productionPublish.js";
import type { PagePublisher } from "../pages/publish.js";
import { removePublishedPageFixture } from "../store/publishedPages/removeFixture.js";
import { type DesktopE2eError, DesktopE2eErrors } from "./e2eErrors.js";
import { type E2ePageFixture, e2ePageFixture } from "./e2eFixture.js";

/**
 * A fixture as its own publish left it: the plan, plus the instant that publish froze it at. The instant is what tells
 * this walk's page from a later publish of the same bytes under the same slug, which the digest alone cannot (Codex
 * r3, `r3b-fixture-remover-rows-only`).
 */
export interface PublishedE2ePageFixture extends E2ePageFixture {
  readonly frozenAtIso: string;
}

/** The prefix a publish's frozen digest carries before its hex. */
const FROZEN_SHA256_PREFIX = "sha256:";

/**
 * Plan a walk's fixture page and publish it under a home, refusing when what was published is not what was planned.
 *
 * @param home the home whose store it is published into
 * @param nonce what makes the slug the walk's own
 * @param nowIso the instant its freeze is stamped with
 * @param publish the publisher — production's store-bound one unless a test names another
 * @param retire takes a refused publish back out of the store — production's remover unless a test names another
 * @returns the published fixture, or why it is not published — a refused one is taken back out of the store
 */
export async function publishE2ePageFixture({
  home,
  nonce,
  nowIso,
  publish = productionPublishPage,
  retire = removeE2ePageFixtureFromStore,
}: {
  home: string;
  nonce: string;
  nowIso: string;
  publish?: PagePublisher;
  retire?: (request: { home: string; fixture: PublishedE2ePageFixture }) => Promise<Result<void, DesktopE2eError>>;
}): Promise<Result<PublishedE2ePageFixture, DesktopE2eError>> {
  const planned = e2ePageFixture({ home, nonce });
  if (planned.isErr()) {
    return err(planned.error);
  }
  const fixture = planned.value;
  const published = await publish({ fragment: fixture.fragment, home, nowIso, slug: fixture.slug });
  if (published.isErr()) {
    return err(DesktopE2eErrors.pageFixturePublishFailed({ detail: published.error.join("; "), slug: fixture.slug }));
  }
  const { path, frozen } = published.value;
  const stored: PublishedE2ePageFixture = { ...fixture, frozenAtIso: frozen.frozenIso };
  let detail: string | undefined;
  if (path !== fixture.path) {
    detail = `the publish named ${path}, not the planned ${fixture.path}`;
  } else if (frozen.sha256 !== `${FROZEN_SHA256_PREFIX}${fixture.bodySha256}`) {
    detail = "the publish froze other bytes than the planned fixture's";
  }
  if (detail === undefined) {
    return ok(stored);
  }
  const removed = await retire({ fixture: stored, home });
  if (removed.isErr()) {
    logger.error({ msg: removed.error.message });
  }
  return err(DesktopE2eErrors.pageFixturePublishFailed({ detail, slug: stored.slug }));
}

/**
 * Take the fixture's rows back out of the store under a home.
 *
 * @param home the home whose store it was published into
 * @param fixture the walk's fixture
 * @returns nothing once removed, or why the store still holds it
 */
export async function removeE2ePageFixtureFromStore({
  home,
  fixture,
}: {
  home: string;
  fixture: PublishedE2ePageFixture;
}): Promise<Result<void, DesktopE2eError>> {
  const removed = await removePublishedPageFixture({
    expectedBodySha256: fixture.bodySha256,
    expectedFrozenAtIso: fixture.frozenAtIso,
    home,
    slug: fixture.slug,
  });
  return removed.mapErr((error) =>
    DesktopE2eErrors.pageFixtureStoreCleanupFailed({ detail: error.message, slug: fixture.slug }),
  );
}
