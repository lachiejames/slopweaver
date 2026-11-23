/**
 * A sentence of the console's own that quotes a read's reason, with the two kept apart. Pure; imports nothing.
 *
 * The owner reads plain English and does not want raw stack traces above the fold. A line such as "the board did not
 * read: <stderr tail>" would put the raw message above the fold inside a sentence the console wrote. So a page model carries the console's words as `lead` and the reason exactly as
 * the read gave it as `why`, and `PlainWhy` (`../components/console/RawFold.tsx`) draws the lead, the reason in plain
 * words (`./plainReason.ts`), and the raw message folded under them. The boundary is kept where the reason enters the
 * model, never recovered later by parsing a composed sentence back apart.
 */

/** The console's own words, and the read's reason they quote, apart. */
export interface QuotedReason {
  /** The console's own complete short sentence, which may be shortened or have its machine ids hidden. */
  readonly lead: string;
  /** The reason exactly as the read gave it: never trimmed, joined or rewritten before the fold. */
  readonly why: string;
}

/**
 * A quoted reason that also names WHAT did not read, for a staleness mark (`./stalenessLabel.ts`), which words its
 * own "<subject> could not be read." around the reason rather than taking the lead.
 */
export interface QuotedRead extends QuotedReason {
  /** What could not be read, in the page's own words: "GitHub's open list for acme/app". */
  readonly subject: string;
}

/** A reason a page model carries: the console's own words, or the reads' reasons it quotes, each kept apart. */
export type ReasonWords = string | readonly QuotedReason[];

/**
 * A reason as ONE string, for a surface that already folds a raw value itself — a `WarningMark` fact, which says its
 * reason plainly with the raw under it, or the voice's reading, which the model words for the owner — and never for a
 * sentence drawn above the fold, which draws each quoted reason through `PlainWhy` instead.
 *
 * @param reason the console's words, or the reasons it quotes
 * @returns the words, or each quoted reason after its lead, joined
 */
export function reasonTextOf({ reason }: { reason: ReasonWords }): string {
  if (typeof reason === "string") {
    return reason;
  }
  return reason.map((quoted) => `${quoted.lead}: ${quoted.why}`).join("; ");
}

/**
 * A reason re-framed in the console's words: the sentence itself when it is the console's own, else each quoted
 * reason's lead — the read's own `why` passes through byte for byte, because rewriting it is the fold's job and nobody
 * else's.
 *
 * @param reason the console's words, or the reasons it quotes
 * @param lead how the console's words are re-framed: a clause added, a machine id hidden
 * @returns the reason, its console words re-framed and every raw reason untouched
 */
export function withLeadsMapped({
  reason,
  lead,
}: {
  reason: ReasonWords;
  lead: (words: string) => string;
}): ReasonWords {
  if (typeof reason === "string") {
    return lead(reason);
  }
  return reason.map((quoted) => ({ lead: lead(quoted.lead), why: quoted.why }));
}

/**
 * A lead as it sits before the reason's plain line: closed by its own stop when it carries one (`.`, `?`, `!`, `:`,
 * `;`), else by a full stop, and one space before what follows.
 *
 * @param lead the console's own sentence
 * @returns the lead, closed, with one trailing space
 */
export function leadBeforeReason({ lead }: { lead: string }): string {
  const trimmed = lead.trimEnd();
  if (/[.?!:;]$/u.test(trimmed)) {
    return `${trimmed} `;
  }
  return `${trimmed}. `;
}
