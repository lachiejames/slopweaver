/**
 * A published page the owner has open in the console's viewer, read for `read_page` as the page's own words, fresh at
 * every read.
 *
 * MEASURED on one call: the owner read a briefing aloud with the voice and the viewer (`app/(console)/view/page.tsx`)
 * registered only a title, so `read_page` answered "registers no reading of its own" and pointed at `action_items`.
 * The thinking model had read the page once through `file_read` near the start and answered every later question from
 * that memory, 20 to 50 minutes old, once telling the owner something belonged in a later cut that the page already
 * covered. Repro: `slopweaver talk call-tools --call <call-id>` beside `talk call-thread --call <call-id>`.
 *
 * So the viewer registers a REFERENCE, never the words: `{ kind: "published-page", slug }`. It crosses to the desktop
 * shell's voice window unchanged (`./desktopPageReading.ts`), and the tool runner resolves it on every `read_page`
 * through the same masked briefing read a card's briefings take (`../components/voice/cardBriefingRead.ts`), so a page
 * republished after the tab loaded is read as it now stands. Pure: the runner does the fetch.
 */
import type { BriefingRead } from "./briefingRead";
import { cardBriefingOf, type ReadCardBriefing } from "./cardBriefings";
import { isPageSlug } from "./localPageHref";
import type { PageView } from "./pageVoice";

/** What the viewer registers for a published page: its slug, and nothing of its words. */
export interface PublishedPageReference {
  readonly kind: "published-page";
  readonly slug: string;
}

/** The reading `read_page` answers with once the reference is resolved: the page's words, as a card's briefing is. */
export interface PublishedPageShows {
  readonly publishedPage: ReadCardBriefing;
}

/**
 * The reference the viewer registers for one published page.
 *
 * @param slug the page's name in the store, as the viewer's address names it
 * @returns the reference
 */
export function publishedPageReference({ slug }: { slug: string }): PublishedPageReference {
  return { kind: "published-page", slug };
}

/**
 * The slug a reading names, when it is EXACTLY a published-page reference with a valid slug — so no page's own
 * reading can ask the runner for a read by happening to carry a `kind`.
 *
 * @param shows a page's registered reading
 * @returns the slug, or `undefined` for any other reading
 */
function referencedSlugOf({ shows }: { shows: unknown }): string | undefined {
  if (typeof shows !== "object" || shows === null || Array.isArray(shows)) {
    return undefined;
  }
  const keys = Object.keys(shows).toSorted();
  if (keys.length !== 2 || keys[0] !== "kind" || keys[1] !== "slug") {
    return undefined;
  }
  const bag: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(shows));
  const slug = bag["slug"];
  if (bag["kind"] !== "published-page" || typeof slug !== "string" || !isPageSlug({ slug })) {
    return undefined;
  }
  return slug;
}

/**
 * The published page a view's reading refers to: the reading this window's page registered, or the one the console
 * window carried across to the voice's window in the desktop shell.
 *
 * @param view the page as the voice sees it
 * @returns the page's slug, or `undefined` when the page on screen is not a published page in the viewer
 */
export function publishedPageSlugOf({ view }: { view: PageView }): string | undefined {
  if (view.carried?.kind === "carried") {
    return referencedSlugOf({ shows: view.carried.shows });
  }
  return referencedSlugOf({ shows: view.shows });
}

/**
 * The view with its reference replaced by the page's words as just read. A carried reference becomes an ordinary
 * reading of this window's: the words were read HERE, not cut in the console window, so a long page reads on through
 * `read_page`'s own windows (`./pageReadWindow.ts`) rather than being refused as a carried cut.
 *
 * @param view the page as the voice sees it, its reading a published-page reference
 * @param slug that reference's slug
 * @param read what reading the page's words came to, fresh
 * @returns the view whose reading is the page's words
 */
export function withPublishedPageRead({
  view,
  slug,
  read,
}: {
  view: PageView;
  slug: string;
  read: BriefingRead;
}): PageView {
  const { carried: _carried, ...rest } = view;
  const shows: PublishedPageShows = { publishedPage: cardBriefingOf({ file: undefined, read, slug }) };
  return { ...rest, shows };
}

/**
 * The view `read_page` answers from: a published page's words read now, through the masked briefing read, on every
 * call — a read on included, so a page republished between two windows changes the reading and the read on is refused
 * rather than splicing two cuts. Any other page's view is returned as it is, and nothing is read.
 *
 * @param view the page as the voice sees it
 * @param readBriefing one page's masked read by slug: the console's briefing route, a plain fake in a test
 * @returns the view to answer from
 */
export async function resolvedPageView({
  view,
  readBriefing,
}: {
  view: PageView;
  readBriefing: (input: { readonly slug: string }) => Promise<BriefingRead>;
}): Promise<PageView> {
  const slug = publishedPageSlugOf({ view });
  if (slug === undefined) {
    return view;
  }
  return withPublishedPageRead({ read: await readBriefing({ slug }), slug, view });
}
