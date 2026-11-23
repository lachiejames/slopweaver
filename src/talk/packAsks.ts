/**
 * The asks half of the voice's context pack (`./contextPack.ts`): the rows the board says wait on the owner's word, each with
 * the owner's own words, their words about its pull requests from the other rows naming them (`./packPrWords.ts`), and the last
 * recorded proof verdict on each (`./packProofs.ts`). Pure: every input is already read.
 */
import { waitsOnOwner } from "../handover/ownerWait.js";
import type { PackAsk, PackUnread } from "./contextPack.js";
import { type PackProofSource, packProofsFor } from "./packProofs.js";
import { type PackPrSteers, packPrWordsOf } from "./packPrWords.js";

/**
 * The asks the board says are the owner's, in the board's order, each with their words beside it.
 *
 * The verdict is the board's `ownerWait`, read rather than re-derived — `site/lib/ownerAsks.ts` explains
 * the four surfaces that once each spelled "waiting on the owner" for themselves and disagreed by half. A row
 * with no question is not an ask the owner can answer, so it is left out exactly as the Queue leaves it out.
 *
 * @param rows the board's rows, as `handover list --json` publishes them
 * @param ownerWordsOf the owner's words behind a row, read from its doc by the caller — `undefined` when it could not be
 * @param proofs the last recorded `handover currency` verdicts, read by the caller
 * @returns the asks
 */
export function packAsksOf({
  rows,
  ownerWordsOf,
  proofs,
}: {
  rows: readonly {
    readonly slug: string;
    readonly ownerWait: string;
    readonly question: string | undefined;
    readonly questionAskedIso: string | undefined;
    readonly priority: string | undefined;
    readonly lean: string | undefined;
    readonly path: string;
    readonly prSteers: PackPrSteers;
    readonly prNamed: readonly string[];
  }[];
  ownerWordsOf: (row: { slug: string; path: string }) => readonly string[] | undefined;
  proofs: PackProofSource;
}): readonly PackAsk[] {
  const out: PackAsk[] = [];
  for (const row of rows) {
    if (!waitsOnOwner({ ownerWait: row.ownerWait }) || row.question === undefined) {
      continue;
    }
    out.push({
      askedIso: row.questionAskedIso,
      ownerWords: ownerWordsOf({ path: row.path, slug: row.slug }),
      lean: row.lean,
      prWords: packPrWordsOf({ prSteers: row.prSteers }),
      priority: row.priority,
      proofs: packProofsFor({ named: row.prNamed, slug: row.slug, source: proofs }),
      question: row.question,
      slug: row.slug,
    });
  }
  return out;
}

/**
 * The board docs the scan could not read, as an unread mark on the asks. A doc that was never read is not on
 * the board at all, so the asks that were read are not the whole count.
 *
 * @param names the unreadable docs' file names, as the board scan reports them
 * @returns the mark, or `undefined` when every doc was read
 */
export function skippedDocsUnread({ names }: { names: readonly string[] }): PackUnread | undefined {
  if (names.length === 0) {
    return undefined;
  }
  return {
    section: "asks",
    why: `${String(names.length)} handover doc(s) could not be read (${names.join(", ")}), so an ask may be missing`,
  };
}
