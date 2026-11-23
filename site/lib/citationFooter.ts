/*
 * Where a citation chip and its hover card's footer go — the chip itself goes to the first link — read off the
 * cited record alone. Pure, so the unit lane holds it without React (`../components/console/CitationChip.tsx` draws
 * it).
 *
 * A GitHub pull request opens IN GITHUB first. A Slack citation chip opens that Slack message in Slack, so a GitHub
 * citation chip is expected to open the pull request in GitHub, and a pull request that opens inside the desktop app
 * loses the card the owner was on: a briefing, a Queue card's pull request and a card's board link each take the owner
 * off the Queue (measured three times on two calls). So the cited GitHub address leads, exactly as cited (a `/files` one stays the
 * diff), and the console's own view of the pull request (`./pullAddress.ts`) and its diff follow in the footer for
 * when the owner wants them. In the desktop app a github.com link opens in the owner's browser
 * (`desktop/src/tabRouting.ts`, `openOutside`).
 */

import { prDiffUrl } from "./askLinks";
import type { CitedSource } from "./citationDisplay";
import { pullAddressOf, pullConsoleHref, pullTabOfAddress } from "./pullAddress";

/** One place the hover card offers to go; the first is where the chip itself goes. */
export interface CitationFooterLink {
  readonly href: string;
  readonly words: string;
  readonly opens: { readonly rel: "noreferrer"; readonly target: "_blank" };
}

/**
 * How every citation opens: in a new tab, never over the page citing it. Measured three times on two calls: a
 * briefing, a Queue card's pull request and a card's board link each took the owner off the Queue with no way back.
 * In the desktop app that is a new tab in its strip, the Queue's tab left where it was, or the owner's browser for an
 * address off the console; in a browser, a new browser tab. A citation is a record the page is talking about;
 * navigation (the sidebar, a page's own controls) stays in place.
 *
 * A briefing the console serves (a local page) is the one exception: a plain click opens it
 * in a modal over the page citing it, the way Slack previews a file (`./previewModal.ts`); a modified click still
 * takes this new tab.
 */
const NEW_TAB = { rel: "noreferrer", target: "_blank" } as const;

/**
 * Where a chip and its card's footer go. A GitHub pull request opens in GitHub first, at the address as cited, then the console's own
 * view of it on the same tab, then that view's diff unless the citation already named the diff. Every other record
 * opens where it lives, with a pull request's diff beside it when `prDiffUrl` names one. Every one opens in a new tab.
 *
 * @param cited the record as the hover card names it — its source's name, and whether it leaves this machine
 * @param href the address the reference opens, as `referenceHref` gives it
 * @returns the links, the chip's own first
 */
export function citationFooterOf({ cited, href }: { cited: CitedSource; href: string }): readonly CitationFooterLink[] {
  const pull = pullAddressOf({ url: href });
  if (pull !== undefined) {
    const tab = pullTabOfAddress({ url: href });
    const links: CitationFooterLink[] = [
      { href, opens: NEW_TAB, words: `open it in ${cited.source}` },
      { href: pullConsoleHref({ address: pull, tab }), opens: NEW_TAB, words: "open it here" },
    ];
    if (tab !== "files") {
      links.push({
        href: pullConsoleHref({ address: pull, tab: "files" }),
        opens: NEW_TAB,
        words: "open its diff here",
      });
    }
    return links;
  }
  let words = "open it here";
  if (cited.external) {
    words = `open it in ${cited.source}`;
  }
  const links: CitationFooterLink[] = [{ href, opens: NEW_TAB, words }];
  const diff = prDiffUrl({ url: href });
  if (diff !== undefined && diff !== href) {
    links.push({ href: diff, opens: NEW_TAB, words: "open its diff" });
  }
  return links;
}
