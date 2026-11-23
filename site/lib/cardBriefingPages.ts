/**
 * A Queue card draws every briefing the voice reads through it — one resolution for both, never two.
 *
 * A briefing the voice can read that the owner's Queue does not draw is a bug: if a briefing is associated with a
 * card, the owner must be able to see it. The voice resolves a briefing from every string a row carries
 * (`./openCard.ts` `cardBriefingAddresses`); each card builder chooses ONE text to scan for its chips (an ask its
 * question, a post its why), so a briefing named only in a row's summary, a lean or an option, or spelled as the
 * console route, would be read aloud and never drawn. `./cardPages.ts` covers the artifact field alone; this covers
 * the class, on every register, by drawing the voice's own list rather than a second guess at it.
 *
 * Applied to every row after its builder, wherever a row is built or rebuilt: `./queueRows.ts` `rowsOf`, a recut or
 * parked card re-laid by `./queueLayout.ts` `standingRows`, the settled acts of `./standingRules.ts`, the settled asks
 * of `./recentQueueDepartures.ts`, and a finding act rebuilt off its pull request (`./queueActRow.ts`
 * `withLookedUpPull`). A refused card draws them too (`QueueCardBody`'s refused branch). Pure and idempotent: a card
 * already drawing a briefing, in any of its spellings, draws it once.
 *
 * `withDeferrals` stamps after this runs, so it stamps only a UTC instant (`./cardDeferrals.ts`), which
 * names no briefing. A fully qualified `localhost.` is this console to both sides (`briefingSlugOf`).
 *
 * Residue, stated: whitespace ends a word here, a tab or newline included, as it ends an address in Slack, Markdown and
 * this console — so `https://example.com/?next=<TAB>page:foo` names `foo` on both sides, though the WHATWG URL parser
 * would strip that tab and read one address. Both sides agree, which is the promise; what would make the reading
 * exact is one typed briefing field on the row, which no register writes today.
 */
import { briefingSlugOf, localPageRoute } from "./localPageHref";
import { cardBriefingAddresses } from "./openCard";
import type { CardPage } from "./queueCard";
import type { CardLink } from "./queueCardAct";
import type { ActLinks } from "./queueCardActLinks";
import type { QueueRow } from "./queueRows";

/**
 * The briefing slugs a set of addresses already names.
 *
 * @returns the slugs
 */
function slugsNamed({ urls }: { urls: readonly string[] }): ReadonlySet<string> {
  const slugs = new Set<string>();
  for (const url of urls) {
    const slug = briefingSlugOf({ url });
    if (slug !== undefined) {
      slugs.add(slug);
    }
  }
  return slugs;
}

/**
 * Where a briefing's chip points. A `file://` address stays, since `consoleHref` rewrites it to this console's own
 * route when drawn; any console spelling becomes the relative route, so an address written while the console served
 * another port (`http://localhost:3000/…`) still opens on the one serving now. Any other address — a pull
 * request, another host's page — is returned as it is.
 *
 * @returns the chip's address
 */
function chipUrl({ url }: { url: string }): string {
  if (url.startsWith("file:")) {
    return url;
  }
  const slug = briefingSlugOf({ url });
  if (slug === undefined) {
    return url;
  }
  return localPageRoute({ slug });
}

/**
 * A chip's route and name when it spells a briefing by a console address: pointed at the console serving now, and
 * named by the briefing it opens — a builder that kept an artifact's absolute `http://localhost:3000/…` byte for byte
 * would otherwise draw a chip to a port nothing serves, under the address as its name. A `file://`
 * chip keeps its own name, which the builder already took off the page; any other address names no briefing.
 *
 * @returns the route and name, or `undefined` when the chip is not a console spelling of a briefing
 */
function consoleChip({ url }: { url: string }): { readonly url: string; readonly slug: string } | undefined {
  if (url.startsWith("file:")) {
    return undefined;
  }
  const slug = briefingSlugOf({ url });
  if (slug === undefined) {
    return undefined;
  }
  return { slug, url: localPageRoute({ slug }) };
}

/**
 * The card's own pages, each console spelling of a briefing routed and named by {@link consoleChip}.
 *
 * @returns the pages, and whether any changed
 */
function routedPages({ pages }: { pages: readonly CardPage[] }): {
  readonly pages: readonly CardPage[];
  readonly changed: boolean;
} {
  const routed = pages.map((page): CardPage => {
    const chip = consoleChip({ url: page.url });
    if (chip === undefined || (chip.url === page.url && chip.slug === page.slug)) {
      return page;
    }
    return { ...page, slug: chip.slug, url: chip.url };
  });
  return { changed: routed.some((page, at) => page !== pages[at]), pages: routed };
}

/**
 * An act's own links, each console spelling of a briefing routed and named by {@link consoleChip}: a strip drawn in the
 * card's place never keeps a port nothing serves.
 *
 * @returns the links
 */
function routedLinks({ links }: { links: readonly CardLink[] }): readonly CardLink[] {
  return links.map((link): CardLink => {
    const chip = consoleChip({ url: link.url });
    if (chip === undefined || (chip.url === link.url && chip.slug === link.label)) {
      return link;
    }
    return { ...link, label: chip.slug, url: chip.url };
  });
}

/**
 * An act's links with a link for each briefing they do not already name: an act panel draws its links strip rather
 * than the card's pages (`../components/console/QueuePanelsAct.tsx`), so a briefing has to reach that strip too.
 *
 * @param links the act's links as built
 * @param pages the briefings the card links
 * @returns the links, a strip with no address becoming one carrying the briefings
 */
function actLinksWith({ links, pages }: { links: ActLinks; pages: readonly CardPage[] }): ActLinks {
  const built = links.kind === "linked" ? links.links : [];
  const held = routedLinks({ links: built });
  const named = slugsNamed({ urls: held.map((link) => link.url) });
  const added = pages
    .filter((page) => {
      const slug = briefingSlugOf({ url: page.url });
      if (slug === undefined) {
        return !held.some((link) => link.url === page.url);
      }
      return !named.has(slug);
    })
    .map((page): CardLink => ({ label: page.slug, url: page.url }));
  const routed = held.some((link, at) => link !== built[at]);
  if (added.length === 0 && !routed) {
    return links;
  }
  return {
    boardNotice: links.boardNotice,
    kind: "linked",
    landingNotice: links.landingNotice,
    links: [...held, ...added],
  };
}

/**
 * The row with every briefing the voice reads through it drawn on the card: each one its pages do not already name is
 * appended after them, in the order the voice finds it, so a cited artifact stays first (`./cardPages.ts`). An act
 * row's links strip gains the same briefings.
 *
 * @param row the row as its register built it
 * @returns the row drawing every briefing it links
 */
export function withBriefingPages({ row }: { row: QueueRow }): QueueRow {
  const own = routedPages({ pages: row.card.pages });
  const named = slugsNamed({ urls: own.pages.map((page) => page.url) });
  const missing = cardBriefingAddresses({ row })
    .filter((briefing) => !named.has(briefing.slug))
    .map((briefing): CardPage => ({ slug: briefing.slug, url: chipUrl({ url: briefing.url }) }));
  const pages = [...own.pages, ...missing];
  const unchanged = missing.length === 0 && !own.changed;
  if (row.record.kind === "act") {
    const links = actLinksWith({ links: row.record.links, pages });
    if (unchanged && links === row.record.links) {
      return row;
    }
    return { ...row, card: { ...row.card, pages }, record: { ...row.record, links } };
  }
  if (unchanged) {
    return row;
  }
  return { ...row, card: { ...row.card, pages } };
}
