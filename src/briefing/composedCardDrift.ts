/**
 * A COMPOSED react-now card may not contradict the page it names. Its question and lean are typed by the
 * chair, so for a page that marks its own (`./pageCardMarks.ts`) they are held to the page's frozen bytes.
 *
 * ## Why every composed card, and not only the ones the fold kept
 *
 * This first shipped as a check on the one-card-per-page fold (`./openPageFold.ts`): a composed card that won
 * over a projected one could not say something else. That left a gap, seen with the real CLI: a composed card
 * naming a marked page the `--open-artifacts` document does NOT list has nothing
 * projected to fold against, so it rendered lean B over the page's A, the exact drift fleet finding
 * `a-react-now-card-is-authored-from-a` measured. Whether a page is listed is a fact about another document,
 * never about what the card may say, so the check reads the page for every composed card that names one, with
 * or without `--open-page-cards`.
 *
 * ## Why a refusal, where the fold is not
 *
 * A duplicate card is recoverable, which is why the fold never refuses. A drifted lean is not: the owner answers "go
 * with your lean" to the card, and the lock-in is stamped with the card's.
 *
 * ## What it holds a card to, and what it cannot
 *
 * Any subject whose PATH opens a page directly inside this home's `pages/` directory, however the address is
 * spelled ({@link publishedAddresses}), read through the same store-backed seam the projection uses
 * (`./publishedPageRead.ts`), so both paths hold a card to identical bytes. A page the store holds no freeze of, or
 * one with no marks, gives nothing to compare, and the composed card stands as typed: composed cards were always
 * typed, and the marks are what this adds. A page whose marks do not read, or that could not be read, refuses the
 * card, naming why. A verb fetches exactly {@link composedPageAddresses} before it asks.
 *
 * Pure but for the injected page reader and file matcher, which a test passes as plain functions.
 */
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { BriefingCard, BriefingReactNow } from "../outbound/briefing/types.js";
import { textOfContent } from "../outbound/briefing/vocabulary.js";
import { localPageSlug, PAGE_FILENAME } from "../pages/url.js";
import { lacksLocalCopy } from "./localCopySubject.js";
import { readPageCardMarks } from "./pageCardMarks.js";
import type { ReadPublishedPage } from "./publishedPageRead.js";

/**
 * The slug of every page directly inside `pagesDirectory` whose `index.html` IS the file `path` opens, judged by
 * the file's identity on disk and never by how either path is spelled. When `path` opens no file, the pages whose
 * directory is the one it names. Empty when it is none of them.
 */
export type PagesOpened = (args: { path: string; pagesDirectory: string }) => readonly string[];

/**
 * The same seam, answering each path from its first answer for the rest of one run.
 *
 * A verb collects the pages to prefetch, awaits the store, then projects. Asked twice, a symlink retargeted while
 * the store answered would name a page that was never fetched, so the collection and the projection
 * read one answer.
 *
 * @param pagesOpened the live seam, asked at most once per directory and path
 * @returns the pinned seam
 */
export function pinPagesOpened({ pagesOpened }: { pagesOpened: PagesOpened }): PagesOpened {
  const answered = new Map<string, readonly string[]>();
  return ({ path, pagesDirectory }) => {
    const key = `${pagesDirectory}\u0000${path}`;
    const held = answered.get(key);
    if (held !== undefined) {
      return held;
    }
    const answer = pagesOpened({ pagesDirectory, path });
    answered.set(key, answer);
    return answer;
  };
}

/**
 * The canonical address of every published page a `file:` subject can be read as, empty when it names no page
 * directly inside `pagesDirectory`.
 *
 * Resolved from the FILE the address opens AND from its spelling, and the card is held to each. `…/pages//queue/index.html`
 * opens the same file yet fails a spelling check; `path.relative` normalises a doubled or `.` segment away, and a
 * query or fragment names no file. The same file is also spelled `…/queue/INDEX.HTML`, through `/tmp` for
 * `/private/tmp`, through a symlink inside `pages/`, and through the macOS firmlink `/System/Volumes/Data/private/…`,
 * which no path resolver folds: so the file is matched by identity against every page, the way the disk itself
 * tells two names of one file apart. Reading by identity alone takes `pages/queue/index.html`, symlinked to an
 * unpublished draft, as the draft — while the freeze and every lock-in are keyed by the slug the address spells.
 * Either reading can be the page the owner rules on, so neither may pass a drifted card. A host is dropped before
 * either (`file://127.0.0.1/…` names the same path to a browser).
 *
 * @returns the addresses `page publish` prints for those pages, which the store keys a freeze by
 */
function publishedAddresses({
  url,
  pagesDirectory,
  pagesOpened,
}: {
  url: string;
  pagesDirectory: string;
  pagesOpened: PagesOpened;
}): readonly string[] {
  if (!URL.canParse(url)) {
    return [];
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "file:") {
    return [];
  }
  parsed.host = "";
  let path: string;
  try {
    path = fileURLToPath(parsed);
  } catch {
    return [];
  }
  const opened = pagesOpened({ pagesDirectory, path }).map((slug) => pageAddress({ pagesDirectory, slug }));
  return [...new Set([...opened, spelledPage({ pagesDirectory, path })].filter((address) => address !== undefined))];
}

/**
 * The page `path` spells, when it is exactly `<pages>/<slug>/index.html`.
 *
 * @returns the address `page publish` prints for that page, or nothing when `path` is no page there
 */
function spelledPage({ path, pagesDirectory }: { path: string; pagesDirectory: string }): string | undefined {
  const parts = relative(pagesDirectory, path).split(sep);
  const slug = parts[0];
  if (parts.length !== 2 || parts[1] !== PAGE_FILENAME || slug === undefined || slug === "..") {
    return undefined;
  }
  return pageAddress({ pagesDirectory, slug });
}

/**
 * The published address of one page in the home's pages directory.
 *
 * @param pagesDirectory the pages directory as the home names it, which the published address is built from
 * @returns the address `page publish` prints for that page, or nothing when the slug makes no local page address
 */
function pageAddress({ pagesDirectory, slug }: { pagesDirectory: string; slug: string }): string | undefined {
  const address = pathToFileURL(join(pagesDirectory, slug, PAGE_FILENAME)).href;
  return localPageSlug({ url: address }) === slug && !lacksLocalCopy({ pagesDirectory, url: address })
    ? address
    : undefined;
}

/**
 * Every page address {@link composedCardDrift} will read for this block — what a verb fetches from the store first.
 *
 * @param block the react-now block holding the composed cards
 * @param pagesDirectory the home's `pages/` directory
 * @param pagesOpened folds any other spelling of a subject into the pages whose file it opens
 * @returns each distinct address, empty when no card names a local page
 */
export function composedPageAddresses({
  block,
  pagesDirectory,
  pagesOpened,
}: {
  block: Pick<BriefingReactNow, "meFacing" | "teamFacing">;
  pagesDirectory: string;
  pagesOpened: PagesOpened;
}): readonly string[] {
  const urls = [...block.teamFacing, ...block.meFacing].flatMap((card) =>
    card.subject?.url === undefined ? [] : [card.subject.url],
  );
  return pageAddressesOf({ pagesDirectory, pagesOpened, urls });
}

/**
 * Every page address a card whose subject is one of these URLs would be held to — {@link composedPageAddresses} for
 * a card not composed yet, such as the one `briefing card` is about to project from a row.
 *
 * @param urls the subjects' addresses, as a card would spell them
 * @param pagesDirectory the home's `pages/` directory
 * @param pagesOpened folds any other spelling of a subject into the pages whose file it opens
 * @returns each distinct address, empty when none names a local page
 */
export function pageAddressesOf({
  urls,
  pagesDirectory,
  pagesOpened,
}: {
  urls: readonly string[];
  pagesDirectory: string;
  pagesOpened: PagesOpened;
}): readonly string[] {
  return [...new Set(urls.flatMap((url) => publishedAddresses({ pagesDirectory, pagesOpened, url })))];
}

/** What one page gives a composed card to be held to. */
type PageMarks =
  | { readonly kind: "none" }
  | { readonly kind: "marked"; readonly question: string; readonly lean: string }
  | { readonly kind: "invalid"; readonly problems: readonly string[] }
  | { readonly kind: "unreadable"; readonly message: string };

/**
 * The question and lean one page marks; nothing when there is nothing to hold a card to; or the marks' problems.
 *
 * A page whose marks do not read is `invalid`, never `none`: treated as unmarked, a lean
 * mark holding a styled span let a composed card render B over a page plainly showing A. A page that tried to mark
 * is never legacy, which is `./openPageCards.ts`'s rule for an entry on the same bytes.
 */
function marksOf({ address, readPage }: { address: string; readPage: ReadPublishedPage }): PageMarks {
  const html = readPage({ url: address });
  // Only a page never frozen has no bytes; a store that could not answer has bytes nobody can read, and
  // letting the card stand as typed there let lean B publish over a freeze marking A.
  if (html.isErr()) {
    return html.error.code === "PAGES_NEVER_FROZEN"
      ? { kind: "none" }
      : { kind: "unreadable", message: html.error.message };
  }
  const marks = readPageCardMarks({ html: html.value });
  if (marks.isErr()) {
    return { kind: "invalid", problems: marks.error };
  }
  if (marks.value.kind === "unmarked") {
    return { kind: "none" };
  }
  return { kind: "marked", lean: marks.value.lean, question: marks.value.question };
}

/**
 * Every composed react-now card whose question or lean differs from what its page marks.
 *
 * @param block the validated react-now block, holding the composed cards
 * @param pagesDirectory the home's `pages/` directory, the only place a page a card is held to may live
 * @param readPage the newest frozen bytes of a local page
 * @param pagesOpened folds any other spelling of a subject into the pages whose file it opens
 * @returns one refusal line per card that disagrees or names a page whose marks do not read, empty when every one
 *   agrees or names no marked page
 */
export function composedCardDrift({
  block,
  pagesDirectory,
  readPage,
  pagesOpened,
}: {
  block: Pick<BriefingReactNow, "meFacing" | "teamFacing">;
  pagesDirectory: string;
  readPage: ReadPublishedPage;
  pagesOpened: PagesOpened;
}): readonly string[] {
  const read = new Map<string, PageMarks>();
  const lines: string[] = [];
  const composed: readonly BriefingCard[] = [...block.teamFacing, ...block.meFacing];
  for (const card of composed) {
    const subject = card.subject;
    if (subject?.url === undefined) {
      continue;
    }
    const url = subject.url;
    // One line per card: the first page it can be read as that refuses it is enough to hold it.
    for (const address of publishedAddresses({ pagesDirectory, pagesOpened, url })) {
      // A page is read once per render, however many cards or spellings name it.
      let marks = read.get(address);
      if (marks === undefined) {
        marks = marksOf({ address, readPage });
        read.set(address, marks);
      }
      const line = refusalLine({ card, marks, text: subject.text, url });
      if (line !== undefined) {
        lines.push(line);
        break;
      }
    }
  }
  return lines;
}

/**
 * Why one composed card may not stand against what one page it names gives, or nothing when it may.
 *
 * @param text the card subject as the owner would recognise it
 * @param url the card subject's address, as the card spells it
 * @returns the refusal line, or nothing when the page holds nothing or agrees with the card
 */
function refusalLine({
  card,
  marks,
  text,
  url,
}: {
  card: BriefingCard;
  marks: PageMarks;
  text: string;
  url: string;
}): string | undefined {
  if (marks.kind === "none") {
    return undefined;
  }
  if (marks.kind === "invalid") {
    return (
      `the react-now card for "${text}" names a page whose card marks do not read, so its question and ` +
      `lean cannot be checked: ${marks.problems.join("; ")}. Fix the marks and republish the page. (${url})`
    );
  }
  if (marks.kind === "unreadable") {
    return (
      `the react-now card for "${text}" names a page whose published bytes cannot be read, so its ` +
      `question and lean cannot be checked: ${marks.message} (${url})`
    );
  }
  const lean = textOfContent({ content: card.lean });
  const drifted = [...(card.question === marks.question ? [] : ["question"]), ...(lean === marks.lean ? [] : ["lean"])];
  if (drifted.length === 0) {
    return undefined;
  }
  return (
    `the react-now card for "${text}" types a ${drifted.join(" and ")} its page does not say; the page ` +
    `marks question "${marks.question}" and lean "${marks.lean}". Make the card say what the page marks, or ` +
    `drop it and card the page with an open-pages entry, which reads both from the page. (${url})`
  );
}
