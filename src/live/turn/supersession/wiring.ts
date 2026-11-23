/**
 * The live wiring for `./run.ts` — the real completion log, the real Slack transport, the real journal.
 *
 * Its own module so `run.ts` stays a shell over seams with no idea what is behind them, which is what lets
 * every one of its orderings be tested with plain functions. This file is the opposite half: no decisions,
 * two constructions — the dependency set, and the one-argument seam the TURN drives — and nothing worth a
 * unit test beyond the facts asserted below.
 *
 * ## The two facts it fixes, and neither is incidental
 *
 * **The accepted metadata kinds are the ANSWER kinds and nothing else.** `slack delete`'s CLI accepts a
 * card, a poll, a stranded progress message and a turn checklist as well, because a human typing that verb
 * is choosing what to remove. A correction is not choosing: it supersedes an ANSWER, so a declaration naming
 * this bot's own checklist or poll is refused on `WRONG_EVENT_TYPE` rather than quietly deleting furniture.
 * Both wire versions are here for the migration reason the CLI has them: an answer posted before the V2
 * renderer landed is still one of ours.
 *
 * **`dryRun` is `false`, always.** There is no dry correction — a turn either supersedes or does not — and
 * the flag exists on `deleteOwnedMessage` for the CLI's sake. Passing a constant here rather than plumbing
 * an option through is the point: there is no code path in the automatic lane that can ask for a rehearsal
 * and then report it as a delete.
 */
import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import type { ReviewVerdict } from "../../../admit/reviewVerdict.js";
import type { PostedMessage } from "../../../corpus/slack/writeTransport.js";
import {
  ASSISTANT_ANSWER_EVENT_TYPE,
  ASSISTANT_ANSWER_EVENT_TYPE_V2,
} from "../../../outbound/assistant/answerMessage.js";
import {
  deleteOwnedMessage,
  type OwnedDeleteTransport,
  readOwnedMessage,
} from "../../../outbound/slack/deleteOwnedMessage.js";
import { readTurnCompletionText } from "../completionStore.js";
import { answerDigestOf } from "../posterAnswer.js";
import type { TurnSupersession } from "../runContract.js";
import { journalReadFailure } from "./atMostOnce.js";
import type { SupersessionWarrant } from "./eligibility.js";
import { supersessionAttempts } from "./journal.js";
import { type SupersessionDeps, settleSupersession } from "./run.js";
import { appendSupersessionEvent, readSupersessionLog } from "./store.js";

/** The only metadata kinds a correction will remove — this bot's own assistant answer, either wire version. */
export const SUPERSEDABLE_EVENT_TYPES: readonly string[] = [
  ASSISTANT_ANSWER_EVENT_TYPE,
  ASSISTANT_ANSWER_EVENT_TYPE_V2,
];

/**
 * The real seams, bound to one home and one Slack transport.
 *
 * @param doorLedger where the delete's door decision is recorded
 * @param home the state home the completion log and the journal live under
 * @param transport the Slack write transport this turn already holds
 * @param nowIso the clock, injected so a replay can hand the fixture its own stopped instant
 * @returns the dependency set `settleSupersession` drives
 */
function liveSupersessionDeps({
  doorLedger,
  home,
  transport,
  nowIso = () => new Date().toISOString(),
}: {
  doorLedger: DoorLedgerPort;
  home: string;
  transport: OwnedDeleteTransport;
  nowIso?: () => string;
}): SupersessionDeps {
  return {
    deleteOwned: ({ posted, unchangedSince }: { posted: PostedMessage; unchangedSince: string }) =>
      deleteOwnedMessage({
        // An automatic delete on a recorded judgement of an ANSWER, which always carries metadata: a bare line
        // is never one, so it stays refused here even though `slack delete` takes it.
        acceptUnmarked: false,
        actor: "bot",
        dryRun: false,
        expectedEventTypes: SUPERSEDABLE_EVENT_TYPES,
        home,
        ledger: doorLedger,
        posted,
        transport,
        unchangedSince,
      }),
    journal: ({ event }) => {
      appendSupersessionEvent({ event, home });
    },
    nowIso,
    readAttempts: () => {
      const log = readSupersessionLog({ home });
      return {
        attempts: supersessionAttempts({ events: log.events }),
        readFailure: journalReadFailure({ readFailure: log.readFailure, unreadable: log.unreadable }),
      };
    },
    readCompletions: () => readTurnCompletionText({ home }),
    readOwned: ({ posted }: { posted: PostedMessage }) =>
      readOwnedMessage({ acceptUnmarked: false, expectedEventTypes: SUPERSEDABLE_EVENT_TYPES, posted, transport }),
  };
}

/**
 * The verdict's own provenance, for the two checks a door override must not be able to waive.
 *
 * Lifted off the verdict HERE rather than passed as a whole `ReviewVerdict` into the pure decision, so that
 * module stays about supersession and gains no dependency on the admit layer's full document shape.
 */
function warrantOf({ verdict }: { verdict: ReviewVerdict | undefined }): SupersessionWarrant | undefined {
  if (verdict === undefined) {
    return undefined;
  }
  return {
    answerDigest: verdict.answerDigest,
    authorSession: verdict.authorSession,
    reviewerSession: verdict.reviewerSession,
  };
}

/**
 * The seam `runTurn` drives, bound to one home, one transport and one REVIEW VERDICT.
 *
 * The verdict is closed over here and never passed through the turn, which is the property rather than a
 * convenience: `../runContract.ts`'s own note on {@link TurnSupersession} says why, and it is the same
 * reason `liveTurnPoster` takes the verdict at construction. The worker that composed the correction
 * declares what it INTENDS to supersede; the second declaration that authorises the delete arrives with the
 * loop, on a verdict the worker never holds.
 *
 * An absent verdict, or one carrying no `supersession`, reaches `settleSupersession` as `undefined` and is
 * refused there on `UNREVIEWED` rather than being filtered out here — so the refusal is journalled with the
 * rest, and a correction whose reviewer never looked leaves a row saying exactly that.
 *
 * @param doorLedger where the delete's door decision is recorded
 * @param home the state home the completion log and the journal live under
 * @param transport the Slack write transport this turn already holds
 * @param verdict the reviewing session's verdict, whose `supersession` is the reviewer's own warrant
 * @param nowIso the clock, injected so a replay can hand the fixture its own stopped instant
 * @returns the seam, ready to pass to `runTurn`
 */
export function liveSupersession({
  doorLedger,
  home,
  transport,
  verdict,
  nowIso,
}: {
  doorLedger: DoorLedgerPort;
  home: string;
  transport: OwnedDeleteTransport;
  verdict: ReviewVerdict | undefined;
  nowIso?: () => string;
}): TurnSupersession {
  const deps = liveSupersessionDeps({ doorLedger, home, transport, ...(nowIso === undefined ? {} : { nowIso }) });
  return ({ askIdentity, declaredTs, postedAnswer, postedAnswerTs, turnId }) =>
    settleSupersession({
      askIdentity,
      declaredTs,
      deps,
      postedAnswerDigest: answerDigestOf({ answer: postedAnswer }),
      postedAnswerTs,
      review: verdict?.supersession,
      turnId,
      warrant: warrantOf({ verdict }),
    });
}
