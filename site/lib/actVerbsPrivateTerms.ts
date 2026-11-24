/**
 * The private-word card's rows of the console's act list, kept beside `./actVerbs.ts` and spread into it whole, so
 * that list stays the one place a slug resolves. Every rule `./actVerbs.ts`'s header states applies here unchanged.
 *
 * The owner answers each proposal on the card that shows its word
 * (`../components/console/PrivateTermProposals.tsx`) with a Yes or a No. A press records that answer beside the proposal and nothing else: the one slot is the
 * proposal's id, the answer is fixed by the row, and no word crosses the argv. The fleet then confirms a yes
 * from that record (`slopweaver private-terms list` names it); `confirm` refuses one answered no.
 */
import type { ActVerb } from "./actVerbs";

/** The two answers, each its own row, so a press can never carry an answer the row did not name. */
export const PRIVATE_TERM_ANSWER_SLUGS = { no: "private-term-no", yes: "private-term-yes" } as const;

/**
 * The Yes and No rows of the private-word card.
 *
 * @param localTimeoutMs the ledger-act timeout, passed in so the list has one number for it
 * @param bySession the console's session name, the one every console press records
 * @returns the rows, Yes first
 */
export function privateTermsActVerbs({
  localTimeoutMs,
  bySession,
}: {
  localTimeoutMs: number;
  bySession: string;
}): readonly ActVerb[] {
  return (["yes", "no"] as const).map((answer) => ({
    argv: [
      "private-terms",
      "answer",
      { shape: "id", slot: "proposal" },
      "--as",
      answer,
      "--via",
      "console",
      "--by-session",
      bySession,
      "--json",
    ],
    readsSlug: "board",
    slug: PRIVATE_TERM_ANSWER_SLUGS[answer],
    timeoutMs: localTimeoutMs,
    title: `slopweaver private-terms answer <proposal> --as ${answer} --via console --by-session ${bySession} --json`,
  }));
}
