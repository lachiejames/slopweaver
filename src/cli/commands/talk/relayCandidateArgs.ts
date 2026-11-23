/**
 * `talk relay`'s `--candidate` and `--reaction`: the owner's ruling on the workstream candidate the voice read the owner. Split
 * from `./relayArgs.ts`, which sits at the file-size ratchet. Pure.
 */
import type { CandidateVerdict } from "../../../talk/candidateRuling.js";
import { STANDALONE_REACTIONS } from "../../../workstreams/reactionWords.js";
import { stringOf } from "./flagValues.js";

/** A candidate id's shape and length, the ones the candidates file holds it to (`CANDIDATE_ID_MAX_CHARS`, 80). */
const CANDIDATE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/u;

/**
 * The ruling a relay carries, or why `--candidate`/`--reaction` are refused: the two go together, the reaction is one
 * of the owner's words, and a relay carries a candidate ruling or a check-in ruling, never both — one turn is one ruling.
 *
 * @param checkIn whether the relay also carries `--covers`, a check-in ruling
 * @param problems the parse's running list, which a refusal is appended to
 * @returns the verdict, or `undefined` when the flags were absent or refused
 */
export function candidateVerdictOf({
  candidate,
  reaction,
  checkIn,
  problems,
}: {
  candidate: string | boolean | undefined;
  reaction: string | boolean | undefined;
  checkIn: boolean;
  problems: string[];
}): CandidateVerdict | undefined {
  const id = stringOf({ value: candidate });
  const word = stringOf({ value: reaction });
  if (id === undefined && word === undefined) {
    return undefined;
  }
  if (id === undefined || word === undefined) {
    problems.push(
      "--candidate and --reaction go together: the candidate read to the owner, and the owner's word on it",
    );
    return undefined;
  }
  const known = STANDALONE_REACTIONS.find((one) => one === word);
  if (known === undefined) {
    problems.push(`--reaction must be one of ${STANDALONE_REACTIONS.join(", ")}, got ${word}`);
  }
  if (!CANDIDATE_ID.test(id)) {
    problems.push(`--candidate is a candidate id such as c-105, got ${id}`);
  }
  if (checkIn) {
    problems.push("talk relay carries one ruling per turn: --candidate with --reaction, or --covers, never both");
  }
  if (known === undefined || !CANDIDATE_ID.test(id) || checkIn) {
    return undefined;
  }
  return { candidate: id, reaction: known };
}
