/**
 * DELETE ONE MESSAGE SLOPWEAVER POSTED — the ownership read-back, the door, and the at-most-once call, as
 * one typed operation with two callers.
 *
 * ## Why this is not where it started
 *
 * Every line here used to live inside `slack delete`'s CLI shell (`../../cli/commands/slack/
 * lifecycleRunDelete.ts`), which was correct while a human typing the verb was the only way a message got
 * removed. A correction turn deleting the answer it supersedes is the second way, and it needed the same
 * three guarantees — the message is read back and confirmed to be this bot's, the delete goes through the
 * admit door as `slack delete`, and an already-gone target is not mistaken for a successful removal. Two
 * copies of that would have been two places for the guard to drift out of, and `live/` cannot import a CLI
 * shell, so the operation moved here and the CLI became one of its callers.
 *
 * ## What it guarantees, stated exactly
 *
 * A HUMAN's message is never deleted, a DIFFERENT Slack app's is never deleted, and a message not shaped
 * like the artifact kinds the caller named is never deleted. `./lifecycleGuards.ts`'s `messageOwnership`
 * header carries the full statement and the one case it cannot exclude: a co-tenant of this exact bot
 * token that imitates slopweaver's metadata. That is a trust boundary rather than a hole to plug — whoever
 * holds the token can already delete anything without passing through this code.
 *
 * What it does NOT establish is whether the message SHOULD go. That is the caller's decision, taken before
 * this operation is entered, and `../../live/turn/supersession/eligibility.ts` is where the destructive
 * caller's own evidence requirements live.
 */
import { DEFAULT_GATES } from "../../admit/door.js";
import type { DoorLedgerPort } from "../../admit/doorLedgerPort.js";
import { throughDoor } from "../../admit/effects.js";
import type { DoorGate, DoorRequest } from "../../admit/types.js";
import { NO_AUTHORED_PROSE, voiceProfileGate } from "../../admit/voiceProfileGate.js";
import type { DeleteMessageOutcome, PostedMessage, SlackWriteTransport } from "../../corpus/slack/writeTransport.js";
import { err, ok, type Result } from "../../lib/result.js";
import { editedAtOrAfter, messageOwnership, type ReadSlackMessage } from "./lifecycleGuards.js";
import { type OwnedDeleteError, OwnedDeleteErrors } from "./ownedDeleteErrors.js";

/** The two transport calls the ownership read-back needs, and nothing else. */
export type OwnershipReadTransport = Pick<SlackWriteTransport, "readMessage" | "whoAmI">;

/** The ownership read plus the at-most-once delete — the whole surface this operation touches. */
export type OwnedDeleteTransport = OwnershipReadTransport & Pick<SlackWriteTransport, "deleteMessageOnce">;

/** What a completed delete actually did — the dry-run arm never reaches the door or the provider. */
export type OwnedDeleteOutcome =
  | { readonly kind: "deleted"; readonly posted: PostedMessage }
  | { readonly kind: "already-gone"; readonly posted: PostedMessage }
  | { readonly kind: "dry-run"; readonly posted: PostedMessage };

/** The reason string a thrown value carries, without assuming it is an `Error`. */
function reasonOf({ thrown }: { thrown: unknown }): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/**
 * The door request every ownership-checked delete is recorded under.
 *
 * ONE builder for both callers, deliberately. A second one would let the automatic lane label a destructive
 * act as some other operation in the ledger a reader audits it from, and the way that happens is never a
 * decision — it is a copy that stopped matching.
 *
 * @param home the state home the ledger is written under
 * @param actor which identity the delete runs as, recorded so an audit is not silently attributed
 * @param targetTs the message being removed, carried as the opaque timestamp it is
 * @returns the request, always the `slack delete` verb
 */
export function ownedDeleteDoorRequest({
  home,
  actor,
  targetTs,
}: {
  home: string;
  actor: "bot" | "me";
  targetTs: string;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "slack", verb: "delete" },
    artifact: { actor, targetTs },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  } satisfies DoorRequest;
}

/**
 * The gates an ownership-checked delete routes through — the same composition `slack delete` has always
 * used, kept here so the two callers cannot install different ones.
 *
 * A delete authors no prose, and it passes {@link NO_AUTHORED_PROSE} rather than skipping the voice gate:
 * a lane that opts out silently is how the bot ended up with no voice check at all, so every lane makes the
 * claim explicitly and the gate answers with no findings.
 *
 * @returns the gate list
 */
export function ownedDeleteGates(): readonly DoorGate[] {
  return [...DEFAULT_GATES, voiceProfileGate(NO_AUTHORED_PROSE)];
}

/**
 * Read a message back and refuse unless this bot posted it, in a shape this operation's caller can branch on.
 *
 * Separate from the delete so a caller that needs to look at the message BEFORE deciding — the supersession
 * path, which checks the live thread and whether the message has been edited since — gets the same read
 * with the same refusals rather than a second one.
 *
 * @param transport the two reads, injected
 * @param posted the channel and timestamp being mutated
 * @param expectedEventTypes the `metadata.event_type` values this caller accepts as its own
 * @param acceptUnmarked accept a message THIS bot posted that carries no metadata at all — see {@link acceptsUnmarked}
 * @returns the normalised message, or exactly why it may not be touched
 */
export async function readOwnedMessage({
  transport,
  posted,
  expectedEventTypes,
  acceptUnmarked,
}: {
  transport: OwnershipReadTransport;
  posted: PostedMessage;
  expectedEventTypes: readonly string[];
  acceptUnmarked: boolean;
}): Promise<Result<ReadSlackMessage, OwnedDeleteError>> {
  let message: ReadSlackMessage | undefined;
  try {
    message = await transport.readMessage({ posted });
  } catch (thrown: unknown) {
    return err(
      OwnedDeleteErrors.ownershipReadFailed({
        operation: "read-message",
        reason: reasonOf({ thrown }),
        ts: posted.ts,
      }),
    );
  }
  if (message === undefined) {
    return err(OwnedDeleteErrors.targetAbsent({ channel: posted.channel, ts: posted.ts }));
  }
  try {
    const verdict = messageOwnership({ expectedEventTypes, message, self: await transport.whoAmI() });
    if (acceptsUnmarked({ acceptUnmarked, message, verdict })) {
      return ok(message);
    }
    return verdictToResult({ message, ts: posted.ts, verdict });
  } catch (thrown: unknown) {
    return err(
      OwnedDeleteErrors.ownershipReadFailed({ operation: "who-am-i", reason: reasonOf({ thrown }), ts: posted.ts }),
    );
  }
}

/**
 * Whether a caller that opted in may take a message this bot posted with NO metadata at all.
 *
 * Only `no-slopweaver-metadata` qualifies, and `messageOwnership` reaches that arm only after it has confirmed
 * the message's `bot_id` is this token's own — so a human's message and another app's stay refused, and so do
 * a foreign event type and an unknown renderer, which are SOMEBODY's shapes rather than none. What it admits is
 * every bare line this bot ever posted: the stranded lane's re-dispatch notice before it carried metadata, and
 * a responder refusal, which still does not. Without it those were unretractable by any verb, however often the
 * owner asked for one to go.
 *
 * `slack delete --as bot` opts in, because a human typing that verb is choosing the message. The supersession
 * lane does not: it deletes on a recorded judgement of an ANSWER, and an answer always carries metadata.
 */
function acceptsUnmarked({
  acceptUnmarked,
  message,
  verdict,
}: {
  acceptUnmarked: boolean;
  message: ReadSlackMessage;
  verdict: ReturnType<typeof messageOwnership>;
}): boolean {
  // `no-slopweaver-metadata` fires on a missing EVENT TYPE alone, so a message carrying a renderer, or any
  // stored metadata, under an empty event type reaches it too — that is a shape somebody wrote, not a bare
  // line, and it stays refused.
  const carriesNothing = message.renderer === undefined && message.stored?.metadata === undefined;
  return acceptUnmarked && verdict.kind === "no-slopweaver-metadata" && carriesNothing;
}

/** Map `messageOwnership`'s verdict onto this domain's own errors, one arm each so none is collapsed. */
function verdictToResult({
  message,
  ts,
  verdict,
}: {
  message: ReadSlackMessage;
  ts: string;
  verdict: ReturnType<typeof messageOwnership>;
}): Result<ReadSlackMessage, OwnedDeleteError> {
  switch (verdict.kind) {
    case "owned":
      return ok(message);
    case "not-ours-bot":
      return err(OwnedDeleteErrors.notOurs({ messageBotId: verdict.messageBotId, ts }));
    case "no-slopweaver-metadata":
      return err(OwnedDeleteErrors.missingMetadata({ ts }));
    case "unexpected-event-type":
      return err(OwnedDeleteErrors.wrongEventType({ found: verdict.found, ts }));
    case "unknown-renderer":
      return err(OwnedDeleteErrors.unknownRenderer({ found: verdict.found, ts }));
    default: {
      const unreachable: never = verdict;
      return unreachable;
    }
  }
}

/** Turn one at-most-once delete attempt into this domain's outcome or its typed failure. */
function outcomeToResult({
  attempt,
  posted,
}: {
  attempt: DeleteMessageOutcome;
  posted: PostedMessage;
}): Result<OwnedDeleteOutcome, OwnedDeleteError> {
  switch (attempt.kind) {
    case "gone":
      return ok({ kind: "deleted", posted });
    case "already-gone":
      return ok({ kind: "already-gone", posted });
    case "failed":
      return err(OwnedDeleteErrors.deleteUnconfirmed({ reason: attempt.reason, ts: posted.ts }));
    default: {
      const unreachable: never = attempt;
      return unreachable;
    }
  }
}

/**
 * Delete one message slopweaver posted: read it back, confirm it is ours, route the delete through the
 * door, and report exactly what happened.
 *
 * `dryRun` is an input rather than a caller's own early return because the CLI's dry run has always
 * performed the ownership read and then written no door row and deleted nothing — a contract worth keeping
 * exactly, and one a second copy of the read would have quietly changed. The automatic lane always passes
 * `false`; there is no dry correction.
 *
 * @param transport the reads and the at-most-once delete, injected
 * @param posted the message to remove
 * @param expectedEventTypes the metadata kinds this caller accepts as its own
 * @param home the state home the door ledger is written under
 * @param ledger the door ledger the delete's decision is recorded through before anything is performed
 * @param actor which identity the delete is recorded as
 * @param dryRun when true, stop after the ownership read and report `dry-run`
 * @param unchangedSince when given, refuse if this read shows an edit at or after that instant
 * @param acceptUnmarked also take a message this bot posted with no metadata — required, so every destructive
 *   caller states its policy; `slack delete` alone passes `true`
 * @returns what happened, or exactly why nothing did
 */
export async function deleteOwnedMessage({
  transport,
  posted,
  expectedEventTypes,
  home,
  ledger,
  actor,
  dryRun,
  unchangedSince,
  acceptUnmarked,
}: {
  transport: OwnedDeleteTransport;
  posted: PostedMessage;
  expectedEventTypes: readonly string[];
  home: string;
  ledger: DoorLedgerPort;
  actor: "bot" | "me";
  dryRun: boolean;
  unchangedSince?: string | undefined;
  acceptUnmarked: boolean;
}): Promise<Result<OwnedDeleteOutcome, OwnedDeleteError>> {
  const owned = await readOwnedMessage({ acceptUnmarked, expectedEventTypes, posted, transport });
  if (owned.isErr()) {
    return err(owned.error);
  }
  // The read that decides and the read before the delete are two different observations, and a caller that
  // judged a message's WORDS has to re-ask here or an edit landing between them is deleted on the strength
  // of a read that stopped being true. The CLI passes nothing: a human typing `slack delete <ts>` is
  // choosing the message rather than acting on a recorded judgement of what it said.
  const editedTs = whenUnchangedSince({ live: owned.value, unchangedSince });
  if (editedTs !== undefined) {
    return err(OwnedDeleteErrors.editedSince({ editedTs, ts: posted.ts }));
  }
  if (dryRun) {
    return ok({ kind: "dry-run", posted });
  }
  return performOwnedDelete({ actor, home, ledger, posted, transport });
}

/** The edit guard, asked only of a caller that supplied an instant to compare against. */
function whenUnchangedSince({
  live,
  unchangedSince,
}: {
  live: ReadSlackMessage;
  unchangedSince: string | undefined;
}): string | undefined {
  if (unchangedSince === undefined) {
    return undefined;
  }
  return editedAtOrAfter({ live, sinceIso: unchangedSince });
}

/**
 * The door-routed half, entered only once ownership is settled.
 *
 * The `try` wraps the WHOLE routed call rather than the delete alone, and the two failure arms it can
 * produce are deliberately different claims: `throughDoor` records its decision BEFORE performing, so a
 * throw from the recording itself leaves the message untouched (`DELETE_ROUTE_FAILED`), while a throw from
 * inside the delete leaves it unknown (`DELETE_UNCONFIRMED`). `entered` is what tells them apart, and it is
 * a variable rather than a guess because a destructive operation's journal must never report "not
 * attempted" over a call that was.
 */
async function performOwnedDelete({
  actor,
  home,
  ledger,
  posted,
  transport,
}: {
  actor: "bot" | "me";
  home: string;
  ledger: DoorLedgerPort;
  posted: PostedMessage;
  transport: OwnedDeleteTransport;
}): Promise<Result<OwnedDeleteOutcome, OwnedDeleteError>> {
  let entered = false;
  try {
    const routed = await throughDoor({
      gates: ownedDeleteGates(),
      home,
      ledger,
      perform: async () => {
        entered = true;
        return transport.deleteMessageOnce({ posted });
      },
      request: ownedDeleteDoorRequest({ actor, home, targetTs: posted.ts }),
    });
    if (routed.kind === "recording-refused") {
      return err(OwnedDeleteErrors.doorRecordingRefused({ cause: routed.error, ts: posted.ts }));
    }
    if (!routed.performed) {
      return err(OwnedDeleteErrors.doorRefused({ decision: routed.decision, ts: posted.ts }));
    }
    return outcomeToResult({ attempt: routed.result, posted });
  } catch (thrown: unknown) {
    const reason = reasonOf({ thrown });
    // `entered` is assigned inside the `perform` closure above, which the flow analysis does not follow,
    // so it reads as always-false there; it is genuinely true on the delete path.
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (entered) {
      return err(OwnedDeleteErrors.deleteUnconfirmed({ reason, ts: posted.ts }));
    }
    return err(OwnedDeleteErrors.deleteRouteFailed({ reason, ts: posted.ts }));
  }
}
