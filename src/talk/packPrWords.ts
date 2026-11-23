/**
 * The owner's words about a pull request an ask's row names, stored on OTHER board rows naming it exactly — the pull-request
 * half of a pack ask (`./contextPack.ts`). The board folds them over every row before any filter
 * (`../handover/prSteers.ts`); this reads that fold off the row and says it, every quote placed by its source row, and
 * past the shown cap the rest counted with the rows that hold them rather than dropped. Pure.
 */
import { clip } from "./packText.js";

/** One quote of the owner's about a pull request, and the row it is stored on. */
export interface PackPrWords {
  readonly identity: string;
  readonly rowSlug: string;
  readonly atIso: string;
  readonly words: string;
}

/** A board row's published pull-request steers, as much of them as the pack reads. */
export type PackPrSteers =
  | readonly {
      readonly identity: string;
      readonly rowSlug: string;
      readonly quote: { readonly words: string; readonly atIso: string };
    }[]
  | undefined;

/**
 * A row's pull-request steers as the ask carries them.
 *
 * @param prSteers the row's published fold, `undefined` on a board that carried none
 * @returns the quotes, or `undefined` when the board carried no fold
 */
export function packPrWordsOf({ prSteers }: { prSteers: PackPrSteers }): readonly PackPrWords[] | undefined {
  return prSteers?.map(({ identity, rowSlug, quote }) => ({
    atIso: quote.atIso,
    identity,
    rowSlug,
    words: quote.words,
  }));
}

/**
 * The owner's words about the row's pull requests from the other rows naming them, each with its source row.
 *
 * @param prWords the ask's quotes, `undefined` on a pack stored before it carried them
 * @param shown how many are drawn before the rest are counted
 * @param maxChars where each quote is cut, in characters
 * @returns the lines
 */
export function prWordsLines({
  prWords,
  shown,
  maxChars,
}: {
  prWords: readonly PackPrWords[] | undefined;
  shown: number;
  maxChars: number;
}): readonly string[] {
  if (prWords === undefined) {
    return [];
  }
  const lines = prWords
    .slice(0, shown)
    .map(
      (one) =>
        `  the owner's words on ${one.identity}, ${one.atIso} on ask:${one.rowSlug}: "${clip({ max: maxChars, text: one.words })}"`,
    );
  const rest = prWords.slice(shown);
  if (rest.length > 0) {
    const rows = [...new Set(rest.map((one) => `ask:${one.rowSlug}`))].join(", ");
    lines.push(
      `  ${String(rest.length)} more of the owner's words on its pull request(s) not shown — board_row on ${rows}`,
    );
  }
  return lines;
}
