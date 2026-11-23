/**
 * A projected page card NAMES ITS LOCAL COPY — the page's address under this home's `pages/` tree, held in the
 * store, never a claude.ai artifact and never a file somewhere a reboot or a sweep can take away.
 *
 * ## The rule
 *
 * Every published page keeps its rendered html under `$SLOPWEAVER_HOME`, never tmp, and an address that
 * stops resolving is answered by republishing from that copy. The local page is the only page there is, and
 * the store holds it (`../pages/publish.ts`). A card whose subject is anywhere else is a card the owner cannot
 * reliably open, whose page no session can republish, and whose history `briefing corrections` cannot diff.
 *
 * ## Measured
 *
 * A supervisor scratch `open-pages.json`: 38 entries — 25 local pages
 * under the home, 5 GitHub or Slack subjects, and 8 `https://claude.ai/code/artifact/<id>` pages with no
 * copy on disk at all (no `pages/<slug>`, no `published-pages/<id>` freeze). Reproduce:
 *
 * ```bash
 * grep -oE '"url": "[^"]*"' <open-pages.json> | grep -c claude.ai  # 8
 * ```
 *
 * ## Why the CARD, not the reader
 *
 * `./openArtifacts.ts` reads the same document for the ranked index, and its ledger lookup still resolves a
 * claude.ai page's rulings under `artifact:<id>`. A reader-level refusal would make that lookup unreachable
 * and redden every `--open-artifacts` render. The card is what asks the owner to act on a page, so the card is
 * where the page has to be real. A page the owner's ruling already settled gets no card, so it is never refused.
 *
 * ## What counts as a page
 *
 * A subject on a `claude.ai` host, or any `file:` address. A GitHub pull request or a Slack thread is a
 * subject that is not a page, and is outside this rule. A `file:` address must have the local-page shape
 * (`../pages/url.ts`) AND sit inside the pages directory this render was given. The shape alone accepts
 * `file:///tmp/x/pages/a/index.html`, which is precisely the tmp copy the rule forbids.
 *
 * Pure: a url and a directory in, a verdict out. `fileURLToPath` converts a string and reads nothing.
 */

import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { localPageSlug, PAGE_FILENAME } from "../pages/url.js";

/**
 * Whether a card subject is a page that does not name its local copy.
 *
 * @param url the card subject's address
 * @param pagesDirectory the absolute `pages/` directory of the home this render publishes under
 * @returns true when the address is page-shaped and is not a local page inside that directory
 */
export function lacksLocalCopy({ url, pagesDirectory }: { url: string; pagesDirectory: string }): boolean {
  if (!URL.canParse(url)) {
    return false;
  }
  const parsed = new URL(url);
  if (parsed.hostname === "claude.ai") {
    return true;
  }
  if (parsed.protocol !== "file:") {
    return false;
  }
  const slug = localPageSlug({ url });
  if (slug === undefined) {
    return true;
  }
  // EXACTLY `<pages>/<slug>/index.html`, the one shape `page publish` writes. Anywhere deeper passes the shape
  // check with a slug that is not this file's: `<pages>/a/pages/b/index.html` links one file while the freeze
  // store, keyed by slug, answers page `b`'s bytes — so a card would read another page's question and lean.
  return relative(pagesDirectory, fileURLToPath(parsed)) !== join(slug, PAGE_FILENAME);
}

/**
 * The refusal for one card whose page has no local copy, naming the fix rather than only the fault.
 *
 * @param label the page as the owner would recognise it
 * @param url the offending address
 * @param pagesDirectory where the page belongs, so the refusal names the real place
 * @returns one operator-facing refusal line
 */
export function localCopyRefusal({
  label,
  url,
  pagesDirectory,
}: {
  label: string;
  url: string;
  pagesDirectory: string;
}): string {
  return (
    `open page "${label}" cannot become a card: ${url} is not its local copy. A page lives at ` +
    `${pagesDirectory}/<slug>/index.html, never on claude.ai or in a temp directory. ` +
    "Republish it from the copy you hold with `slopweaver page publish <slug> --page <fragment>.html --review <id>` " +
    "(the review from `slopweaver page review-prepare`) and " +
    "point the entry's `url` at the address that prints, or drop the entry until the page exists."
  );
}
