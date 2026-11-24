/**
 * What one self-review round reports: the outcome shape every caller receives, and the lines it prints.
 *
 * Split out of `./selfReviewRun.ts`, which performs the round, along the seam between doing it and saying what
 * happened: nothing here reads the ledger or calls GitHub.
 */
import { type NotPerformed, notPerformedLines } from "../../../admit/doorRefusal.js";
import {
  type SelfReviewRoundRead,
  type SelfReviewRoundSetAside,
  setAsideRound,
} from "../../../outbound/github/selfReviewRound.js";

/**
 * The externally observable result of one requested self-review round.
 *
 * `setAside` is present only when the ledger held a round at this address that is not this pull request's
 * (another repository once had the address, or the round predates binding), so it is reported rather than
 * resolved silently or dropped silently.
 */
export type GithubSelfReviewOutcome = (
  | {
      readonly kind: "posted";
      readonly comments: number;
      readonly resolvedThreads: number;
      readonly number: number;
      readonly url: string;
    }
  | { readonly kind: "refused"; readonly reason: string }
  /** The door refused the round, or its decision could not be recorded: the caller renders the door's own refusal. */
  | { readonly kind: "not-performed"; readonly through: NotPerformed }
  | { readonly kind: "unconfirmed"; readonly reason: string; readonly locus: string }
) & { readonly setAside?: SelfReviewRoundSetAside };

/**
 * The outcome, carrying the set-aside round the read found, when it found one.
 *
 * @param outcome what the round did
 * @param read what the ledger held at this pull request's address before the round
 * @returns the outcome, with `setAside` only when the read was one
 */
export function withSetAside({
  outcome,
  read,
}: {
  outcome: GithubSelfReviewOutcome;
  read: SelfReviewRoundRead;
}): GithubSelfReviewOutcome {
  const setAside = setAsideRound({ read });
  return setAside === undefined ? outcome : { ...outcome, setAside };
}

/**
 * Render why a second caller is refused while an outcome for this locus is still unresolved.
 *
 * @param locus the pull request's ledger address
 * @param pending the round the held lock records, or null when it records none
 * @returns the unconfirmed outcome naming what holds the lock
 */
export function reservationTakenOutcome({
  locus,
  pending,
}: {
  locus: string;
  pending: { readonly headSha: string; readonly reservedIso: string } | null;
}): GithubSelfReviewOutcome {
  const detail =
    pending === null
      ? "the reservation lock is held but records no round"
      : `a round for head ${pending.headSha} was reserved at ${pending.reservedIso}`;
  return { kind: "unconfirmed", locus, reason: `${detail}; inspect GitHub before any retry` };
}

/**
 * Render human-readable outcome lines shared by every PR-raising and PR-updating command.
 *
 * @param outcome the confirmed, refused, not-performed or ambiguous lifecycle result
 * @param command the invocation that carried the round, as the owner would type it, which a door refusal names
 * @returns concise lines suitable for the command result channel
 */
export function selfReviewOutcomeLines({
  outcome,
  command,
}: {
  outcome: GithubSelfReviewOutcome;
  command: string;
}): readonly string[] {
  const setAside =
    outcome.setAside === undefined
      ? []
      : [
          `self-review: set aside the round confirmed at ${outcome.setAside.confirmedIso} for ${outcome.setAside.locus}: ` +
            "it is not bound to this pull request, so none of its threads were resolved",
        ];
  return [...outcomeKindLines({ command, outcome }), ...setAside];
}

/** The lines each outcome kind reports, before any set-aside notice. */
function outcomeKindLines({
  outcome,
  command,
}: {
  outcome: GithubSelfReviewOutcome;
  command: string;
}): readonly string[] {
  if (outcome.kind === "not-performed") {
    return notPerformedLines({ command, through: outcome.through });
  }
  if (outcome.kind === "posted") {
    return [
      `self-review: posted ${String(outcome.comments)} inline comment(s) on #${String(outcome.number)} and resolved ` +
        `${String(outcome.resolvedThreads)} previous thread(s)`,
      outcome.url,
    ];
  }
  if (outcome.kind === "unconfirmed") {
    return [`self-review UNCONFIRMED at ${outcome.locus}: ${outcome.reason}`];
  }
  return [`self-review refused: ${outcome.reason}`];
}
