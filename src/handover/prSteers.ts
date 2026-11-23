/**
 * The owner's words about a pull request, wherever the board recorded them — the fold that puts every quote of theirs
 * on a card about that pull request, not only the quotes stored on the card's own row.
 *
 * A pack entry built from the card's own row alone carried none of the owner's words when another row held their ask
 * for before-and-after proof, naming the same pull request by URL, and the voice then put the seat's question to the
 * owner as if they had never asked. Repro: `grep -l '<owner>/<repo>/pull/<number>' ~/.slopweaver/handovers/*.md`.
 *
 * ## "Names that pull request" is exact
 *
 * A row names `owner/repo#number` through a GitHub link, an explicit `owner/repo#N`, or a bare `#N` / `PR N` when the
 * row's own `repo:` resolved to exactly one repository. Never a plain number, a slug, a title or a branch: two rows
 * that merely look alike are not about the same pull request, and a quote moved onto the wrong card is worse than none.
 * A relay row spelling the number with no repository (".<number>") is therefore NOT joined — stated residue, not a miss.
 *
 * ## Only words already attributed to the owner travel
 *
 * The quote stored at a row's anchor and its readable steers (`./hisWordsSteers.ts`), each with the anchor it was read
 * off. A row's prose is never promoted into the owner's voice. A quote travels to a pull request only when it is ABOUT that
 * one — its row names no other, or its own words name it ({@link addSteers}). Pure: rows in, values out.
 */
import { findPrLinks } from "../review/prLink.js";
import type { HandoverDoc } from "./doc.js";
import type { HisWords } from "./hisWords.js";

/** One quote of the owner's about a pull request, recorded on another row naming it. */
export interface PrSteer {
  /** The pull request, lowercased `owner/repo#number`. */
  readonly identity: string;
  /** The row the quote is stored on. */
  readonly rowSlug: string;
  readonly quote: HisWords;
}

/** One board row as the fold reads it. */
export interface PrSteerRow {
  readonly slug: string;
  /** The row's `repo:` resolved to `owner/repo`, when it resolved. A bare `#N` names a pull request only with this. */
  readonly repoSlug: string | undefined;
  /** Every string of the row a reference may sit in — its summary, question, reason, evidence and the owner's words. */
  readonly texts: readonly string[];
  /** The owner's words stored on the row ({@link heldHisWordsOf}). */
  readonly quotes: readonly HisWords[];
}

/** An explicit `owner/repo#N` — not preceded by a path character, so a URL's tail is not read twice. */
const OWNER_REPO_NUMBER = /(?<![\w./-])([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})#(\d{1,12})(?!\d)/gu;

/** A bare `#N`, not part of `owner/repo#N` or an anchor in a URL. */
const BARE_NUMBER = /(?<![\w/#.&])#(\d{1,12})(?!\d)/gu;

/** `PR N` or `PR #N`, the spelling a seat writes in prose. */
const PR_NUMBER = /\bPR #?(\d{1,12})(?!\d)/giu;

/**
 * A paste placeholder Claude Code writes into a turn — `[Image #N]`, `[Pasted text #N +N lines]`. Its number counts
 * attachments, never a pull request: MEASURED, read as bare numbers they put phantom pull requests
 * on the board. Repro: `slopweaver handover currency --json | jq '.pullRequests[].identity'`.
 */
export const PASTE_PLACEHOLDER = /\[(?:Image|Pasted text) #\d{1,6}[^\]\n]{0,80}\]/giu;

/**
 * The canonical identity of one pull request.
 *
 * @param owner the repository owner
 * @param repo the repository name
 * @param number the pull request's number
 * @returns `owner/repo#number`, lowercased
 */
function prIdentityOf({ owner, repo, number }: { owner: string; repo: string; number: number }): string {
  return `${owner}/${repo}#${String(number)}`.toLowerCase();
}

/**
 * Every pull request a row's strings name exactly, deduped, first-seen order.
 *
 * @param texts the row's strings
 * @param repoSlug the row's resolved `owner/repo`, which alone lets a bare `#N` name a pull request
 * @returns each identity, lowercased `owner/repo#number`
 */
export function prIdentitiesIn({
  texts,
  repoSlug,
}: {
  texts: readonly string[];
  repoSlug: string | undefined;
}): readonly string[] {
  const found = new Set<string>();
  for (const text of texts.map((one) => one.replaceAll(PASTE_PLACEHOLDER, " "))) {
    for (const link of findPrLinks({ haystack: text })) {
      found.add(prIdentityOf(link));
    }
    for (const [, owner, repo, digits] of text.matchAll(OWNER_REPO_NUMBER)) {
      found.add(prIdentityOf({ number: Number(digits), owner: owner!, repo: repo! }));
    }
    if (repoSlug === undefined) {
      continue;
    }
    const [owner, repo] = repoSlug.split("/");
    if (owner === undefined || repo === undefined) {
      continue;
    }
    for (const match of [...text.matchAll(BARE_NUMBER), ...text.matchAll(PR_NUMBER)]) {
      found.add(prIdentityOf({ number: Number(match[1]), owner, repo }));
    }
  }
  return [...found];
}

/**
 * The owner's words stored on a row, each with the anchor it was read off: the quote at the row's `anchor:`, then every
 * readable further steer, in stored order. A group that does not read is left out — the card names its defect.
 *
 * @param doc the row's parsed doc
 * @returns the quotes
 */
export function heldHisWordsOf({ doc }: { doc: HandoverDoc }): readonly HisWords[] {
  const quotes: HisWords[] = [];
  if (doc.hisWords.kind === "held") {
    quotes.push(doc.hisWords.hisWords);
  }
  for (const steer of doc.hisWordsSteers) {
    if (steer.group.kind === "held") {
      quotes.push(steer.group.hisWords);
    }
  }
  return quotes;
}

/** One quote's identity for dedupe: the same words off the same anchor are one quote, however many rows copied it. */
function quoteKey({ quote }: { quote: HisWords }): string {
  return `${quote.anchor}\n${quote.words}`;
}

/** One pull request the board names: every row naming it, and every quote of the owner's stored on one of them. */
export interface PrOnBoard {
  readonly identity: string;
  /**
   * Each row naming it, in board order. A reader joining a verdict back to a row by slug also checks that the row
   * names this pull request NOW (its published `prNamed`): a slug is reused and rewritten, a reading is a tick old.
   */
  readonly rowSlugs: readonly string[];
  /** The owner's words about it stored on those rows ({@link addSteers}), deduped, the first row in board order keeping a quote several copied. */
  readonly steers: readonly PrSteer[];
}

/**
 * Every pull request the board names exactly, with the rows naming it and the owner's words stored on them.
 *
 * @param rows every board row, in board order
 * @returns each pull request, keyed by identity, in first-named order
 */
export function prsOnBoard({ rows }: { rows: readonly PrSteerRow[] }): ReadonlyMap<string, PrOnBoard> {
  const out = new Map<string, { identity: string; rowSlugs: string[]; steers: PrSteer[]; keys: Set<string> }>();
  for (const row of rows) {
    const named = prIdentitiesIn({ repoSlug: row.repoSlug, texts: row.texts });
    for (const identity of named) {
      const pr = out.get(identity);
      if (pr === undefined) {
        out.set(identity, { identity, keys: new Set(), rowSlugs: [row.slug], steers: [] });
      } else {
        pr.rowSlugs.push(row.slug);
      }
      addSteers({ alone: named.length === 1, pr: out.get(identity)!, row });
    }
  }
  return new Map([...out].map(([identity, { rowSlugs, steers }]) => [identity, { identity, rowSlugs, steers }]));
}

/**
 * Add one row's quotes about a pull request to its steers, each quote once however many rows copied it.
 *
 * A quote is ABOUT the pull request when its row names that pull request and no other, or when the quote's own words
 * name it. A row naming many — a supervisor handoff names eighty — says nothing about which one each of the owner's words
 * was about. MEASURED: without this, one transcript asking for a screenshot of a console page led 97
 * cards with a proof gap. Repro: `slopweaver handover currency --json | jq '[.pullRequests[].proof.kind]'`.
 *
 * @param pr the pull request being folded, with the dedupe keys it holds
 * @param row the row naming it
 * @param alone whether the row names this pull request and no other
 */
function addSteers({
  pr,
  row,
  alone,
}: {
  pr: { identity: string; steers: PrSteer[]; keys: Set<string> };
  row: PrSteerRow;
  alone: boolean;
}): void {
  for (const quote of row.quotes) {
    const key = quoteKey({ quote });
    const about = alone || prIdentitiesIn({ repoSlug: row.repoSlug, texts: [quote.words] }).includes(pr.identity);
    if (about && !pr.keys.has(key)) {
      pr.keys.add(key);
      pr.steers.push({ identity: pr.identity, quote, rowSlug: row.slug });
    }
  }
}

/**
 * For every row, the owner's words about each pull request it names, recorded on the OTHER rows naming it. A quote the row
 * already stores is left out, and a quote several rows copied appears once, under the first row in board order.
 *
 * Run over the WHOLE board, before any filter narrows it, so a quote on a settled or filtered-out row still reaches
 * the card about its pull request.
 *
 * @param rows every board row, in board order
 * @returns each row's steers, by POSITION, never by slug — two rows sharing a slug are a board defect the Queue still
 *   draws as two cards, and keyed by slug the later one's steers overwrote the earlier's; a row naming no pull
 *   request, or one nobody else quoted the owner on, has an empty list
 */
export function prSteersByRow({ rows }: { rows: readonly PrSteerRow[] }): readonly (readonly PrSteer[])[] {
  const prs = prsOnBoard({ rows });
  const out: (readonly PrSteer[])[] = [];
  for (const row of rows) {
    const own = new Set(row.quotes.map((quote) => quoteKey({ quote })));
    const steers: PrSteer[] = [];
    for (const identity of prIdentitiesIn({ repoSlug: row.repoSlug, texts: row.texts })) {
      for (const steer of prs.get(identity)!.steers) {
        const key = quoteKey({ quote: steer.quote });
        // The row's own quotes are already in `own`, so no slug test: two rows sharing a slug are still two.
        if (!own.has(key)) {
          own.add(key);
          steers.push(steer);
        }
      }
    }
    out.push(steers);
  }
  return out;
}
