/**
 * The published page `slopweaver desktop e2e` and the console's browser lane open in the viewer, so the Pages
 * surface is walked without depending on any page of the owner's. Pure: `./e2ePageFixtureStore.ts` publishes it through the
 * real publisher before the walk, and the walk's cleanup takes it out of the store, its only copy, after.
 *
 * A page of the owner's would make the step test that content rather than the viewer: a page can run script or name a
 * remote image, and a console error in the viewer's frame reaches the walk's watcher and fails the step. So the fixture is inert — no script, image, stylesheet, font, form or address — and carries a marker
 * no page of the owner's does, so a 404 or the wrong document can never pass for it. Its bytes are the same on every walk, so
 * the store holds one body for every walk there has ever been, and only the slug is the walk's own.
 */
import { sha256Hex } from "#lib/hash.js";
import { err, ok, type Result } from "#lib/result.js";
import { pagePath } from "../pages/publish.js";
import { wrapPageFragment } from "../pages/shell.js";
import { isValidPageSlug, PAGE_FILENAME } from "../pages/url.js";
import { type DesktopE2eError, DesktopE2eErrors } from "./e2eErrors.js";

/** The attribute only the fixture carries, which the step's landmark waits for inside the viewer's frame. */
export const FIXTURE_MARKER = "data-desktop-e2e-published-page";

/** Every fixture slug's prefix, and the only slugs the store's fixture remover will touch. */
const FIXTURE_SLUG_PREFIX = "desktop-e2e-";

/** The route the console serves a local page under (`site/app/api/page/[slug]/[...file]/route.ts`). */
const PAGE_ROUTE = "/api/page";

/** The console page the viewer's back control names, so the step can check it reads "Back to the Queue". */
const BACK_TO = "/queue";

/** The fixture's authored fragment: a title and one marked heading, nothing that loads or runs. */
const FIXTURE_FRAGMENT =
  "<title>Desktop end to end: published page</title>\n" +
  `<main ${FIXTURE_MARKER}><h1>Published page viewer</h1>` +
  "<p>A walk of the desktop app wrote this page and removes it when the walk ends.</p></main>\n";

/** One walk's fixture page: what is published, the identity it is published under, and how the viewer asks for it. */
export interface E2ePageFixture {
  /** The page's own slug, unique to the walk. */
  readonly slug: string;
  /** What the publisher is handed: the authored fragment, no shell. */
  readonly fragment: string;
  /** The whole document the publish writes, shell included. */
  readonly html: string;
  /** The lower-case hex sha-256 of that document, which the store keys its body by. */
  readonly bodySha256: string;
  /** Its identity path, which no file is at: the store holds the page. */
  readonly path: string;
  /** The path the viewer's frame shows it at. */
  readonly framePath: string;
  /** The viewer's address for it, back control pointed at the Queue. */
  readonly viewerPath: string;
}

/**
 * Whether a slug is a fixture's: the prefix, then a non-empty walk nonce, and a valid page slug as a whole.
 *
 * @param slug the slug in question
 * @returns true only for a slug `e2ePageFixture` could have planned
 */
export function isE2ePageFixtureSlug({ slug }: { slug: string }): boolean {
  return slug.startsWith(FIXTURE_SLUG_PREFIX) && slug.length > FIXTURE_SLUG_PREFIX.length && isValidPageSlug({ slug });
}

/**
 * Plan one walk's fixture page under a state home.
 *
 * @param home the state home the page is published under
 * @param nonce what makes the slug the walk's own, so two walks never share or remove each other's page
 * @returns the fixture, or why the nonce makes no valid slug
 */
export function e2ePageFixture({
  home,
  nonce,
}: {
  home: string;
  nonce: string;
}): Result<E2ePageFixture, DesktopE2eError> {
  const slug = `${FIXTURE_SLUG_PREFIX}${nonce}`;
  if (!isE2ePageFixtureSlug({ slug })) {
    return err(DesktopE2eErrors.pageFixtureUnplanned({ slug }));
  }
  const framePath = `${PAGE_ROUTE}/${slug}/${PAGE_FILENAME}`;
  const html = wrapPageFragment({ fragment: FIXTURE_FRAGMENT });
  return ok({
    bodySha256: sha256Hex({ bytes: html }),
    fragment: FIXTURE_FRAGMENT,
    framePath,
    html,
    path: pagePath({ home, slug }),
    slug,
    viewerPath: `/view?${new URLSearchParams({ back: BACK_TO, src: framePath }).toString()}`,
  });
}
