/**
 * The working-checklist quartet of a `TurnPoster` — advance it, delete it, finalize it, and post it — plus a
 * plain notice, and the render step the notice and the answer path share.
 *
 * Split out of `./poster.ts` so that file stays under this repo's line cap.
 *
 * Every frame is an ordinary metadata-bearing Slack message. `postWorking` creates it once, `advanceWorking`
 * and `finalizeWorking` re-render it through `chat.update`, and `deleteWorking` removes it directly. Keeping
 * both terminal methods is still useful because the turn's answer path first tries deletion and falls back
 * to a truthful final frame when Slack refuses or cannot confirm it.
 */

import type { DoorLedgerPort } from "../../admit/doorLedgerPort.js";
import type { SlackWriteTransport } from "../../corpus/slack/writeTransport.js";
import { logger } from "../../lib/logger.js";
import { updateArtifactSchema } from "../../outbound/artifact/schema.js";
import { renderAssistantMessage } from "../../outbound/assistant/answerMessage.js";
import type { ResolvedMentions } from "../../outbound/slack/render.js";
import type { SlackCardChrome, SlackTurnPayload } from "../../outbound/slack/types.js";
import type { AskIdentity } from "../ask/identity.js";
import { cardStaysForAnotherAsk, mayWriteCardOnDisk } from "../ask/sharedCard.js";
import type { TurnAnswerCard } from "./answer.js";
import { deleteWorkingImpl } from "./posterChecklistDelete.js";
import { asRef, routed, turnDoorRequest } from "./posterDoor.js";
import type { PostedRef, TurnPoster } from "./run.js";
import { TurnRefusedError } from "./run.js";

/**
 * `reapEarlierCard`'s body — delete one card an earlier turn on this ask posted, through the door.
 *
 * Routed, unlike `./posterChecklistDelete.ts`'s `deleteWorkingImpl`: that one removes the message THIS turn just posted, while this
 * removes one a different turn posted, possibly days ago, and the ledger is the only record that it went.
 * Already-gone counts as gone (`deleteMessageCall`). Never throws — see `TurnPoster.reapEarlierCard`.
 *
 * EXPORTED as well as bound into {@link workingPosterMethods}, because a card is not always reaped by a turn:
 * `slopweaver turn satisfied` retracts an ask's cards when ANOTHER ask's answer already covers it, and no
 * turn runs for that ask at all. Routing that through the same function is what keeps "an earlier card went
 * through the door" one fact rather than two implementations of it.
 *
 * @param askIdentity the ask both this turn and the card belong to
 * @param doorLedger where the door's decision is recorded
 * @param home the resolved state home
 * @param posted the earlier card
 * @param transport the Slack write transport
 * @param turnId the id of the turn doing the reaping
 * @returns whether the card is confirmed gone
 */
export async function reapEarlierCardImpl({
  askIdentity,
  doorLedger,
  home,
  posted,
  transport,
  turnId,
}: {
  askIdentity: AskIdentity;
  doorLedger: DoorLedgerPort;
  home: string;
  posted: PostedRef;
  transport: SlackWriteTransport;
  turnId: string;
}): Promise<boolean> {
  try {
    if (cardStaysForAnotherAsk({ askIdentity, home, what: "reap", workingTs: posted.ts })) {
      return true;
    }
    return await routed({
      home,
      ledger: doorLedger,
      perform: () => deleteWorkingImpl({ posted, transport }),
      request: turnDoorRequest({ askIdentity, home, targetTs: posted.ts, turnId, verb: "reap-earlier-card" }),
      what: "reap a card an earlier turn on this ask posted",
    });
  } catch {
    return false;
  }
}

/**
 * `finalizeWorking`'s body. Best-effort: replace the undeleted checklist with one truthful terminal frame.
 *
 * @param askIdentity the exact ask this checklist belongs to
 * @param doorLedger where the door's decision is recorded
 * @param frame the frame renderer closed over by the poster that built this
 * @param home the resolved state home
 * @param posted the checklist message being corrected
 * @param steps the checklist's final steps
 * @param task the bracketed task label on the author row
 * @param transport the Slack write transport
 * @param turnId the id correlating this write with its turn
 * @returns `true` once the message was actually corrected, `false` when even this fallback failed — the
 *   caller's only signal that the checklist is genuinely stuck, since this method never throws
 */
export async function finalizeWorkingImpl({
  askIdentity,
  doorLedger,
  frame,
  home,
  posted,
  steps,
  task,
  transport,
  turnId,
}: {
  askIdentity: AskIdentity;
  doorLedger: DoorLedgerPort;
  frame: (input: { steps: Parameters<TurnPoster["postWorking"]>[0]["steps"]; task: string }) => SlackTurnPayload;
  home: string;
  posted: PostedRef;
  steps: Parameters<TurnPoster["postWorking"]>[0]["steps"];
  task: string;
  transport: SlackWriteTransport;
  turnId: string;
}): Promise<boolean> {
  // NEVER throws, however hostile the failure — an adversarial review found the obvious version escapes
  // when `updateTurn` fails, or even the CAUGHT error's own `.message` getter throws when read.
  // Both callers of `finalizeWorking` (the delete-failed fallback, the withheld path) run this AFTER their
  // own answer or notice has already posted successfully, so a rejection here must never read as the turn
  // having failed — it is reported through the logger AND returned as `false` instead, so the checklist's
  // own stuck state is never merely implied by silence.
  try {
    if (cardStaysForAnotherAsk({ askIdentity, home, what: "final frame", workingTs: posted.ts })) {
      return true;
    }
    await routed({
      home,
      ledger: doorLedger,
      perform: async () =>
        transport.updateTurn({ payload: frame({ steps, task }), posted: { channel: posted.channel, ts: posted.ts } }),
      request: turnDoorRequest({ askIdentity, home, targetTs: posted.ts, turnId, verb: "finalize" }),
      what: "finalize the turn's checklist once it could not be deleted",
    });
    return true;
  } catch (error) {
    try {
      logger.error({
        msg: `turn ${turnId}: could not finalize the checklist after it could not be deleted — ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    } catch {
      // Reading a hostile error's `.message`/`toString` can itself throw. Logging the failure is a courtesy,
      // never something this method's "never throws" contract may depend on succeeding.
    }
    return false;
  }
}

/**
 * `advanceWorking`'s body — replace the whole current projection in the existing checklist message.
 *
 * @param askIdentity the exact ask this checklist belongs to
 * @param doorLedger where the door's decision is recorded
 * @param home the resolved state home
 * @param posted the checklist message being advanced
 * @param frame the frame renderer closed over by the poster that built this
 * @param steps the checklist's current steps
 * @param task the bracketed task label on the author row
 * @param transport the Slack write transport
 * @param turnId the id correlating this write with its turn
 */
export async function advanceWorkingImpl({
  askIdentity,
  doorLedger,
  home,
  posted,
  frame,
  steps,
  task,
  transport,
  turnId,
}: {
  askIdentity: AskIdentity;
  doorLedger: DoorLedgerPort;
  home: string;
  posted: PostedRef;
  frame: (input: { steps: Parameters<TurnPoster["postWorking"]>[0]["steps"]; task: string }) => SlackTurnPayload;
  steps: Parameters<TurnPoster["postWorking"]>[0]["steps"];
  task: string;
  transport: SlackWriteTransport;
  turnId: string;
}): Promise<void> {
  // A sub-ask that rode this card and is still working owns what it shows; skipped, never thrown.
  if (!mayWriteCardOnDisk({ askIdentity, home, workingTs: posted.ts })) {
    return;
  }
  await routed({
    home,
    ledger: doorLedger,
    perform: async () =>
      transport.updateTurn({
        payload: frame({ steps, task }),
        posted: { channel: posted.channel, ts: posted.ts },
      }),
    request: turnDoorRequest({ askIdentity, home, targetTs: posted.ts, turnId, verb: "advance" }),
    what: "advance the turn's checklist",
  });
}

/**
 * `postNotice`'s body. Deliberately NOT a stream: a notice (a held-for-review or failure card) never
 * carries media and is never advanced in place — it is written once and stands — so a stream buys it
 * nothing a plain `chat.postMessage` does not already give, while adding a start/stop lifecycle with no
 * advance to fill.
 */
async function postNoticeImpl({
  askIdentity,
  chrome,
  card,
  doorLedger,
  home,
  mentions,
  transport,
  turnId,
}: {
  askIdentity: AskIdentity;
  chrome: SlackCardChrome;
  card: TurnAnswerCard;
  doorLedger: DoorLedgerPort;
  home: string;
  mentions: ResolvedMentions;
  transport: SlackWriteTransport;
  turnId: string;
}): Promise<PostedRef> {
  return asRef({
    posted: await routed({
      home,
      ledger: doorLedger,
      perform: async () =>
        transport.postAssistantMessage({
          channel: askIdentity.channel,
          payload: renderAnswerMessage({ card, chrome, mentions }),
          threadTs: askIdentity.threadTs,
        }),
      request: turnDoorRequest({ askIdentity, home, turnId, verb: "notice" }),
      what: "post the turn's notice",
    }),
  });
}

/** `postWorking`'s body — post the first metadata-bearing checklist frame. */
async function postWorkingImpl({
  askIdentity,
  doorLedger,
  frame,
  home,
  steps,
  task,
  transport,
  turnId,
}: {
  askIdentity: AskIdentity;
  doorLedger: DoorLedgerPort;
  frame: (input: { steps: Parameters<TurnPoster["postWorking"]>[0]["steps"]; task: string }) => SlackTurnPayload;
  home: string;
  steps: Parameters<TurnPoster["postWorking"]>[0]["steps"];
  task: string;
  transport: SlackWriteTransport;
  turnId: string;
}): Promise<PostedRef> {
  return asRef({
    posted: await routed({
      home,
      ledger: doorLedger,
      perform: async () =>
        transport.postTurn({
          channel: askIdentity.channel,
          payload: frame({ steps, task }),
          threadTs: askIdentity.threadTs,
        }),
      request: turnDoorRequest({ askIdentity, home, turnId, verb: "working" }),
      what: "post the turn's working message",
    }),
  });
}

/**
 * A poster carrying ONLY `postNotice` — for a caller that has a card to put in the thread and nothing else.
 *
 * The same shape, and the same reasoning, as `./posterIndicators.ts`'s `liveChecklistAdvancer`: building a
 * whole `liveTurnPoster` to reach one method would demand a withhold judgement, a review verdict and an
 * upload-readiness poll that a notice has no use for and the caller would have to invent. Its live caller is
 * `../../cli/commands/turn/block.ts`, which posts the in-thread tag saying a step is waiting on human
 * the owner — a notice by every property that word has here: written once, never advanced, carrying no media.
 *
 * @param askIdentity the exact ask this notice posts to, and nowhere else
 * @param chrome the operator's full card chrome
 * @param doorLedger where the door's decision is recorded
 * @param home the resolved state home, for the door ledger
 * @param mentions the already-resolved owner tag the card may render — see `ownerTag` for why once
 * @param transport the Slack write transport
 * @param turnId the id correlating this write with its turn
 * @returns a poster carrying only `postNotice`
 */
export function liveNoticePoster({
  askIdentity,
  chrome,
  doorLedger,
  home,
  mentions,
  transport,
  turnId,
}: {
  askIdentity: AskIdentity;
  chrome: SlackCardChrome;
  doorLedger: DoorLedgerPort;
  home: string;
  mentions: ResolvedMentions;
  transport: SlackWriteTransport;
  turnId: string;
}): Pick<TurnPoster, "postNotice"> {
  return {
    postNotice: ({ card }) =>
      postNoticeImpl({ askIdentity, card, chrome, doorLedger, home, mentions, transport, turnId }),
  };
}

/**
 * The working-checklist quartet of a `TurnPoster` — advance it, delete it, finalize it, and post it — plus a
 * plain notice. Split out so `liveTurnPoster` itself stays under this repo's line cap; every param is
 * exactly what those methods close over there.
 *
 * @param askIdentity the exact ask these methods post to
 * @param chrome the operator's full card chrome, for a notice
 * @param doorLedger where each write's door decision is recorded
 * @param frame the frame renderer closed over by the poster that built this
 * @param home the resolved state home, for the door ledger
 * @param noticeMentions the already-resolved owner tag a notice may render — see `ownerTag` for why it is
 *   resolved once
 * @param transport the Slack write transport
 * @param turnId the id correlating these writes with their turn
 * @returns the five `TurnPoster` methods this quartet (plus notice) owns
 */
export function workingPosterMethods({
  askIdentity,
  chrome,
  doorLedger,
  frame,
  home,
  noticeMentions,
  transport,
  turnId,
}: {
  askIdentity: AskIdentity;
  chrome: SlackCardChrome;
  doorLedger: DoorLedgerPort;
  frame: (input: { steps: Parameters<TurnPoster["postWorking"]>[0]["steps"]; task: string }) => SlackTurnPayload;
  home: string;
  noticeMentions: ResolvedMentions;
  transport: SlackWriteTransport;
  turnId: string;
}): Pick<
  TurnPoster,
  "advanceWorking" | "deleteWorking" | "finalizeWorking" | "postNotice" | "postWorking" | "reapEarlierCard"
> {
  return {
    advanceWorking: ({ posted, steps, task }) =>
      advanceWorkingImpl({ askIdentity, doorLedger, frame, home, posted, steps, task, transport, turnId }),
    deleteWorking: async ({ posted }) =>
      cardStaysForAnotherAsk({ askIdentity, home, what: "delete", workingTs: posted.ts }) ||
      deleteWorkingImpl({ posted, transport }),
    finalizeWorking: ({ posted, steps, task }) =>
      finalizeWorkingImpl({ askIdentity, doorLedger, frame, home, posted, steps, task, transport, turnId }),
    postNotice: ({ card }) =>
      postNoticeImpl({ askIdentity, card, chrome, doorLedger, home, mentions: noticeMentions, transport, turnId }),
    postWorking: ({ steps, task }) =>
      postWorkingImpl({ askIdentity, doorLedger, frame, home, steps, task, transport, turnId }),
    reapEarlierCard: ({ posted }) => reapEarlierCardImpl({ askIdentity, doorLedger, home, posted, transport, turnId }),
  };
}

/**
 * Validate the turn's form and render it as the bot's own top-level answer message.
 *
 * The form is parsed through `updateArtifactSchema` rather than trusted, even though this repo built it —
 * the caps it enforces are measured properties of the rendered content, and a turn whose answer grew past
 * one would otherwise be refused by Slack with nothing said about why. A refusal here names the field.
 *
 * Renders through `renderAssistantMessage` rather than the operator card renderer over in
 * `../../outbound/slack/render.ts`. Both now carry the same full chrome (author row, dividers, detail
 * label) — this one still never calls `renderUpdateCard` itself, though, which stays reserved, unchanged,
 * for the `slack post` operator verb; it gets the chrome by reusing `renderChromeBlocks`.
 *
 * @param card the turn's form and its clamp notes
 * @param chrome the operator's full card chrome, from `chromeFromProfile({home})`
 * @returns the exact `chat.postMessage` arguments, minus the channel
 */
function renderAnswerMessage({
  chrome,
  card,
  mentions,
}: {
  chrome: SlackCardChrome;
  card: TurnAnswerCard;
  mentions: ResolvedMentions;
}) {
  const parsed = updateArtifactSchema.safeParse(card.artifact);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new TurnRefusedError(`the turn built a message its own schema refuses — ${issues}`);
  }
  return renderAssistantMessage({ artifact: parsed.data, chrome, mentions });
}
