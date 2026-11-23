/**
 * What the press-time re-read DECIDES, kept apart from the loop that presses.
 *
 * `./landingPress.ts` owns the sequence — cap, head re-read, argv, ledger rows. This file owns the one
 * question that sequence asks per row: given a conversation and a check rollup read immediately before the
 * click, may this row be pressed, and which of the two findings may the press name for itself?
 *
 * Both waivers are computed from THAT read rather than from the row the fleet read produced, and that is the
 * whole point: an approval withdrawn in between must mean no acknowledgement, and a run that went red in
 * that window must mean the rollup is no longer provably superseded. Only the fresh read can say either.
 */

import type { AcknowledgeableSubject } from "../../../admit/types.js";
import { CODEX_LOOP_SUBJECT } from "../../../codex/landingGate.js";
import { summarizeChecks } from "../../../live/github/checks.js";
import type { PrLiveState } from "../../../live/github/reviewState.js";
import { rollupSupersessionProof } from "../../../live/github/rollupSupersession.js";
import type { LandingRow } from "../../../review/landing.js";
import { remoteJudgementSignals } from "../../../review/landingDispatch.js";
import { oursResolvable, threadDetails } from "../../../review/prStateDetail.js";
import {
  conversationTallies,
  pressCodexWaiverReason,
  standingChangesRequested,
} from "../../../review/reviewSignals.js";
import { ROLLUP_SUPERSEDED_SUBJECT } from "./enqueueAcknowledgements.js";
import type { LandingPressDeps } from "./landingPress.js";

/**
 * One finding the press answers for itself: the subject it acknowledges, the reason written to the door
 * ledger, and the two spellings of the clause that says so.
 *
 * The clauses are carried on the waiver rather than switched on its subject, so a reader of a press outcome
 * and a reader of a dry-run outcome are looking at one authored pair of sentences instead of a `switch`
 * two surfaces could fall out of step over.
 *
 * Composed only by {@link judgmentAtPressTime}; `./landingPress.ts` carries the list it was handed onto its
 * argv and its ledger row without ever building one.
 */
export interface PressWaiver {
  readonly subject: AcknowledgeableSubject;
  readonly reason: string;
  /** The clause a DRY RUN prints, already prefixed with its own separator. */
  readonly would: string;
  /** The clause a press that HAPPENED prints, already prefixed with its own separator. */
  readonly did: string;
}

/**
 * What the press-time re-read decided: the refusal, or the clearance and what the press may acknowledge for
 * itself.
 *
 * Two-armed rather than the `string | undefined` refusal it used to be, because one read answers several
 * questions — the conversation, and the head's own check rollup — and asking GitHub twice for one pull
 * request would be the same read twice. `clear` is still the only arm that presses; a waiver never widens
 * what is pressed, only what the press names.
 *
 * `unproven` rides beside the waivers rather than inside them: it is the sentence saying why the press did
 * NOT answer the rollup for itself, which a reader needs beside `github enqueue`'s own refusal and which is
 * not a refusal of this verb's own.
 */
export type PressJudgment =
  | { readonly kind: "refused"; readonly detail: string }
  | {
      readonly kind: "clear";
      readonly waivers: readonly PressWaiver[];
      readonly unproven: string | undefined;
      /**
       * The node ids of OUR own open walkthrough threads, as the press-time read found them.
       *
       * Off the fresh read for the same reason the waivers are: a thread a human resolved in the window
       * between the fleet read and the click must not be resolved again, and one whose id the read did not
       * carry is dropped rather than guessed at. Bounded by the truncation refusal above — a press over a
       * short thread page never happens, so this list is complete whenever it is non-empty.
       */
      readonly oursResolvable: readonly string[];
    };

/**
 * The clauses naming every waiver, or the empty string when there are none.
 *
 * The dry run gets them for the same reason it gets the refusal: a dry run that hides an acknowledgement
 * the real run would make is a lie about what `--press` is going to do. The tense is a field rather than
 * two copies of each sentence, because the two spellings drifting apart is how a reader ends up believing a
 * dry run and a press said different things.
 *
 * @param waivers every finding this press answers for itself, in a stable order
 * @param tense `would` for a dry run, `did` for a press that happened
 * @returns the clauses, each already prefixed with its own separator, or the empty string
 */
export function waiverClause({ waivers, tense }: { waivers: readonly PressWaiver[]; tense: "would" | "did" }): string {
  return waivers.map((waiver) => (tense === "would" ? waiver.would : waiver.did)).join("");
}

/**
 * The clause saying why the press did NOT answer the superseded rollup for itself, or the empty string.
 *
 * Printed beside `github enqueue`'s own refusal rather than instead of it: the enqueue says WHICH finding
 * stands, and this says why the press could not prove the one finding it is allowed to answer. Without it a
 * reader sees only "refused it" and has no way to tell a live red from a proof this read could not make.
 *
 * @param unproven what {@link rollupSupersessionProof} could not establish, or `undefined`
 * @returns the clause, already prefixed with its own separator, or the empty string
 */
export function unprovenClause({ unproven }: { unproven: string | undefined }): string {
  if (unproven === undefined) {
    return "";
  }
  return `; the superseded rollup was NOT acknowledged — ${unproven}`;
}

/**
 * Whether the remote conversation turned into something the owner has to read themselves since the fleet read judged
 * this row, and — when it did not — which of the two findings the press may answer for itself.
 *
 * An unreadable conversation blocks the press for the same reason an unreadable head does: a write over a
 * state this run could not confirm is what the verb exists to avoid, and "could not read" is never the same
 * answer as "nothing arrived".
 *
 * Both waivers are computed from THIS read rather than from the row, and that is the point: an approval
 * withdrawn between the fleet read and the click must mean no acknowledgement, and a run that went red in
 * that window must mean the rollup is no longer provably superseded. Only the fresh read can say either. It
 * is also why the checks rollup rides this ONE call (`productionJudgmentNow`, `./landingDeps.ts`) rather
 * than a second request: a second read would reopen the very window this function closes.
 *
 * A snapshot this read could not parse cannot prove anything here by construction rather than by a check —
 * it carries no checks at all, so `rollupSupersessionProof` answers `absent` and nothing is acknowledged.
 *
 * @param row the row about to be pressed
 * @param deps the injected edges
 * @param home the state home whose credential the read uses
 * @returns the refusal, or the clearance with every finding the press may answer for itself and the
 *   sentence saying why it could not answer the superseded rollup
 */
export async function judgmentAtPressTime({
  row,
  deps,
  home,
}: {
  row: LandingRow;
  deps: LandingPressDeps;
  home: string | undefined;
}): Promise<PressJudgment> {
  const fresh = await deps.judgmentNow({ home })({ number: row.number, repoSlug: row.repoSlug });
  if (fresh.isErr()) {
    return {
      detail:
        `not pressed: its review conversation could not be re-read (${fresh.error.message}), and a press over ` +
        "a conversation this run could not confirm is not made",
      kind: "refused",
    };
  }
  const state = fresh.value;
  const refusal = refusalInState({ state });
  if (refusal !== undefined) {
    return { detail: refusal, kind: "refused" };
  }
  return waiversInState({ state });
}

/**
 * Why this state must NOT be pressed, or `undefined` when nothing in it stands in the way. Pure.
 *
 * A read that came back SHORT is not a read that found nothing, and the signal a press has to see lives in
 * whichever page GitHub declined to send. `landingDispatch` already treats both flags as terminal evidence a
 * dispatch may not conclude over; the write path owes the same answer. A Codex review built the exact shape:
 * a hundred resolved threads, a hundred-and-first opened by a reviewer, and a press over a page that stopped
 * at a hundred.
 *
 * @param state the conversation as the press-time read found it
 * @returns the sentence the outcome prints, or `undefined` when the row may be pressed
 */
function refusalInState({ state }: { state: PrLiveState }): string | undefined {
  const truncated = [
    ...(state.threadsTruncated ? ["its review threads"] : []),
    ...(state.reviewsTruncated ? ["its reviews"] : []),
  ];
  if (truncated.length > 0) {
    return (
      `not pressed: ${truncated.join(" and ")} did not fit one page, so a signal needing the owner's judgment could ` +
      "be sitting in the part this read did not see"
    );
  }
  const threads = threadDetails({ prAuthorLogin: state.authorLogin, threads: state.threads });
  const signals = remoteJudgementSignals({
    threads,
    conversations: conversationTallies({ authorLogin: state.authorLogin, threads }),
    standingChangesRequested: standingChangesRequested({ authorLogin: state.authorLogin, reviews: state.reviews }),
  });
  if (signals.length === 0) {
    return undefined;
  }
  return `not pressed: ${signals.join("; ")} — that arrived after this read judged it, and it is the owner's to read`;
}

/**
 * The clearance: every finding this state lets the press answer for itself, and the sentence saying why it
 * could not answer the superseded rollup. Pure, and only ever reached once {@link refusalInState} passed.
 *
 * A snapshot this read could not parse cannot prove anything here by construction rather than by a check —
 * it carries no checks at all, so `rollupSupersessionProof` answers `absent` and nothing is acknowledged.
 *
 * @param state the conversation and check rollup as the press-time read found them
 * @returns the `clear` judgment, with its waivers in a stable order
 */
function waiversInState({ state }: { state: PrLiveState }): PressJudgment {
  const ours = oursResolvable({ details: threadDetails({ prAuthorLogin: state.authorLogin, threads: state.threads }) })
    .map((detail) => detail.id)
    .filter((id) => id !== "");
  const waivers: PressWaiver[] = [];
  const pairing = pressCodexWaiverReason({
    authorLogin: state.authorLogin,
    reviews: state.reviews,
    reviewsTruncated: state.reviewsTruncated,
  });
  if (pairing !== undefined) {
    waivers.push({
      did: ", acknowledging the Codex pairing floor on a standing human approval",
      reason: pairing,
      subject: CODEX_LOOP_SUBJECT,
      would: "; a standing human approval would acknowledge the Codex pairing floor",
    });
  }
  const proof = rollupSupersessionProof({
    snapshot: state.checks,
    summary: summarizeChecks({ checks: state.checks.checks }),
  });
  if (proof.kind === "proven") {
    waivers.push({
      did: ", acknowledging the superseded rollup on a replacement this read proved",
      reason: proof.reason,
      subject: ROLLUP_SUPERSEDED_SUBJECT,
      would: "; a proven replacement would acknowledge the superseded rollup",
    });
  }
  return {
    kind: "clear",
    oursResolvable: ours,
    unproven: proof.kind === "unproven" ? proof.why : undefined,
    waivers,
  };
}
