/**
 * The two verify passes that read nothing: the organisation would not read, or the run's `--deadline` arrived
 * while it was being read. Either way every row stays exactly as the corpus had it, and the pass says why.
 */
import type { RankInput } from "../../../sessionStart/rank.js";
import type { RowVerification } from "./verifyRows.js";

/**
 * The pass that could not start, because the organisation that names a row's repository would not read.
 *
 * Every row stays exactly as the corpus had it, none reads as verified or settled, and the refusal's own message —
 * which names `slopweaver org set` — is the could-not-see line. The list is still written: it is the one page every
 * session opens on, so an install that has not written its organisation sees its rows marked unchecked and why, the
 * way a missing credential reads, rather than no list at all. No repository is guessed in its place.
 *
 * @param inputs every candidate the legs produced, after the owner's resolutions
 * @param refusal the organisation read's own message
 * @returns the unverified pass
 */
export function unverifiedWithoutOrganisation({
  inputs,
  refusal,
}: {
  inputs: readonly RankInput[];
  refusal: string;
}): RowVerification {
  return {
    couldNotSee: [`no row was verified live: ${refusal}`],
    cutShort: false,
    inputs,
    origins: inputs.map((input) => input.item),
    reads: 0,
    settledLive: [],
  };
}

/** The line a pass prints when the deadline arrived during the organisation read, before any row was re-read. */
export const ORGANISATION_CUT_SHORT_LINE =
  "not read, the organisation: this run reached its --deadline while reading it, so no row was re-read live and every row carries the corpus's own state";

/**
 * The pass the deadline stopped before it began — the organisation read that names a row's repository was still
 * in flight. Every row stays exactly as the corpus had it, as past a deadline mid-pass, and the line says it was
 * the organisation read the deadline stopped.
 *
 * @param inputs every candidate the legs produced, after the owner's resolutions
 * @returns the unverified pass, cut short
 */
export function unverifiedPastDeadline({ inputs }: { inputs: readonly RankInput[] }): RowVerification {
  return {
    couldNotSee: [ORGANISATION_CUT_SHORT_LINE],
    cutShort: true,
    inputs,
    origins: inputs.map((input) => input.item),
    reads: 0,
    settledLive: [],
  };
}

/**
 * What a verify pass contributes to the list's `cutShort`: nothing when it was not cut, ONE entry when it was —
 * naming the organisation read when that is what the deadline stopped, so a fully cut run still names at most the
 * five parts `yourListSchema` admits.
 *
 * @param verified the pass, or undefined when none was asked for
 * @returns the parts the list names as cut
 */
export function verifyCutParts({ verified }: { verified: RowVerification | undefined }): readonly string[] {
  if (verified?.cutShort !== true) {
    return [];
  }
  if (verified.couldNotSee.includes(ORGANISATION_CUT_SHORT_LINE)) {
    return ["the live re-read, its organisation read unfinished"];
  }
  return ["the live re-read"];
}
