/**
 * The admit-door plumbing every turn write shares: the request shape, the refusal message, and the
 * refuse-or-throw wrapper.
 *
 * Split out of `./poster.ts` so that file stays under this repo's line cap — every function here is a
 * building block the working-checklist quartet (`./posterWorking.ts`) and the answer path (`./posterAnswer.ts`)
 * both close over, never a decision of its own.
 */

import { DEFAULT_GATES } from "../../admit/door.js";
import type { DoorLedgerPort } from "../../admit/doorLedgerPort.js";
import { doorRefusalLines } from "../../admit/doorRefusal.js";
import { throughDoor } from "../../admit/effects.js";
import type { DoorDecision, DoorRequest } from "../../admit/types.js";
import { REPLY_ARTIFACT_FIELD, type ReplyContext } from "../../admit/withhold.js";
import type { PostedMessage } from "../../corpus/slack/writeTransport.js";
import type { AskIdentity } from "../ask/identity.js";
import { DoorRecordingRefusedError, DoorRefusedError, type PostedRef } from "./run.js";

/**
 * The door request for one of a turn's writes.
 *
 * `artifact` carries counts and ids, never the question or the answer prose. The ledger is a record of
 * what was done, and putting a colleague's question into it would make every turn a disclosure into a file
 * nobody expects to hold conversation content.
 *
 * The ONE exception is `reply`, and it is not a hedge on the rule above. A judgement cannot judge a reply it
 * cannot see, so the answer write — and only the answer write — carries the question and the draft's
 * above-the-fold line for the gate to read. The LEDGER still records neither: `doorDecisionRecord` writes the
 * action, the effect, the status and the findings, and never the artifact.
 *
 * @param verb which write is being made
 * @param askIdentity the exact ask this write belongs to
 * @param home the resolved state home
 * @param turnId the id correlating the write with its turn
 * @param targetTs the message being edited, when this is an edit
 * @param mediaCount how many images ride along, when this is the answer write
 * @param reply the context the withhold judgement reads; present on the answer write alone
 * @param noPictureBecause the answer's own reason for attaching no picture, recorded on the ledger row as an
 *   `unshown-items` acknowledgement — present only when the form carried one, which the parse admits only
 *   when the picture question actually fired
 * @returns the door request
 */
export function turnDoorRequest({
  verb,
  askIdentity,
  home,
  turnId,
  targetTs,
  mediaCount,
  reply,
  noPictureBecause,
}: {
  verb: string;
  askIdentity: AskIdentity;
  home: string;
  turnId: string;
  targetTs?: string | undefined;
  mediaCount?: number | undefined;
  reply?: ReplyContext | undefined;
  noPictureBecause?: string | undefined;
}): DoorRequest {
  return {
    ...(noPictureBecause === undefined
      ? {}
      : { acknowledgements: [{ reason: noPictureBecause, subject: "unshown-items" as const }] }),
    action: { kind: "verb", noun: "turn", verb },
    artifact: {
      // Every turn write goes out under the bot's own name, so the voice profile is settled here rather
      // than threaded through each caller. `../../admit/voiceProfileGate.ts` reads this field and raises
      // its own finding when a lane leaves it out, which is why it is a literal rather than an omission.
      actor: "bot",
      // `channel` stays a top-level field for compatibility with every existing door-ledger reader; the full
      // exact identity rides alongside it under its own key rather than replacing it.
      askIdentity,
      channel: askIdentity.channel,
      turnId,
      ...(targetTs === undefined ? {} : { targetTs }),
      ...(mediaCount === undefined ? {} : { mediaCount }),
      ...(reply === undefined ? {} : { [REPLY_ARTIFACT_FIELD]: reply }),
    },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}

/**
 * Why the door refused, in the words of the gates that refused it. The status alone ("warn") names no
 * cause, and this text is what the owner reads in Slack when a turn will not send — so every finding's
 * summary AND its correction go in, rather than being discarded at the throw.
 *
 * @param decision the door's decision
 * @returns the refusal reason, findings first
 */
export function refusalDetail({ decision }: { decision: DoorDecision }): string {
  return doorRefusalLines({ command: "posting this turn's answer", decision }).join("\n");
}

/**
 * A posted message in the turn's own vocabulary.
 *
 * @param posted the transport's own posted-message shape
 * @returns the narrower ref the turn passes around
 */
export function asRef({ posted }: { posted: PostedMessage }): PostedRef {
  return { channel: posted.channel, ts: posted.ts };
}

/**
 * Run an effect through the door, turning a refusal into a throw the turn reports.
 *
 * `home` is passed explicitly, and that is a FIX rather than tidying: `throughDoor` defaults the ledger's home
 * to the resolved default, so before this every turn wrote its decisions to `$SLOPWEAVER_HOME` no matter what
 * `--home` said — while `meta.home` on the very same record said the other directory. Measured
 * against a proof home: the ledger file was never created there and the lines landed in the default home.
 *
 * A decision the store could not record throws {@link DoorRecordingRefusedError}, never a {@link DoorRefusedError}:
 * the door may have passed it, and a store fault is not a policy refusal.
 *
 * @param home the resolved state home the door ledger writes to
 * @param ledger where the door's decision is recorded before the effect runs
 * @param request the door request describing this write
 * @param perform the effect to run once the door admits it
 * @param what a short description of the effect, for the refusal message
 * @returns the result of `perform`, once the door admits the write
 */
export async function routed<T>({
  home,
  ledger,
  request,
  perform,
  what,
}: {
  home: string;
  ledger: DoorLedgerPort;
  request: DoorRequest;
  perform: () => Promise<T>;
  what: string;
}): Promise<T> {
  const outcome = await throughDoor({ gates: [...DEFAULT_GATES], home, ledger, perform, request });
  if (outcome.kind === "recording-refused") {
    throw new DoorRecordingRefusedError(
      `the door's decision to ${what} could not be recorded, so nothing was sent — ${outcome.error.message}`,
    );
  }
  if (outcome.kind === "door-refused") {
    throw new DoorRefusedError(`the admit door refused to ${what} — ${refusalDetail({ decision: outcome.decision })}`);
  }
  return outcome.result;
}
