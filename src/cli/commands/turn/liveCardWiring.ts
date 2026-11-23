/**
 * The REAL seams `./ensureCard.ts` drives — the effectful shell around that module's decision.
 *
 * Every one of them is a thing that already exists somewhere else, reached rather than reimplemented: the
 * poster is `../listen/liveCapture.ts`'s own `liveCapturedChecklistDeps`, the frame is
 * `../../../live/listen/capture.ts`'s `firstCardFrame`, the lifecycle read is `startedRefForAsk` and the
 * brief write is `writeBrief`. That is the point of the split — the dispatch path stands up the SAME card
 * capture would have, on the same wiring, so there is exactly one progress-card shape in `src/outbound`
 * (owner ruling) and no second producer to drift from it. The ADVANCE is the same discipline one step
 * on: it writes `dispatchedCardFrame` through `liveChecklistAdvancer`, the identical `advanceWorking`
 * primitive `turn status` and the loop's sweep already edit that card with.
 *
 * **Everything Slack-shaped is resolved INSIDE `postCard`, and that is load-bearing.** The overwhelmingly
 * common dispatch has a card already — capture posted it — and does not post one here at all. Resolving a
 * bot token, a transport and a supervisor session eagerly would make a dispatch that needs none of them fail
 * on a home that has no token, which is a refusal about the wrong thing: MEASURED against this repo's own
 * `turn dispatch` unit suite, every inline and read-only-subagent case refused that way.
 */
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { slackBotToken } from "../../../config.js";
import { isAlreadyGoneThrowable, makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { logger } from "../../../lib/logger.js";
import { isRecord } from "../../../lib/parsers.js";
import type { StartedChecklist } from "../../../live/ask/checklist.js";
import { type AskIdentity, askIdentityOf } from "../../../live/ask/identity.js";
import { mayWriteCardOnDisk, parentCardOnDisk } from "../../../live/ask/sharedCard.js";
import { appendAskLifecycleEvent, startedRefForAsk } from "../../../live/ask/store.js";
import { dispatchedCardFrame, firstCardFrame } from "../../../live/listen/capture.js";
import type { Mention } from "../../../live/listen/mention.js";
import type { TurnRoutingBrief } from "../../../live/turn/brief.js";
import { writeBrief } from "../../../live/turn/briefStore.js";
import { liveChecklistAdvancer } from "../../../live/turn/poster.js";
import { readProgressLog } from "../../../live/turn/progressLog.js";
import { detectSupervisorSession } from "../../../supervisor/session.js";
import { liveCapturedChecklistDeps, preWorkerProvenance } from "../listen/liveCapture.js";
import { chromeFromProfile, turnChromeFrom } from "../slack/wiring.js";
import type { LiveCardDeps } from "./ensureCard.js";

/**
 * The brief's ask as a {@link Mention}, which is the shape the shared poster takes.
 *
 * A projection, never an invention: every field comes off the brief, and `text` is the question the brief
 * already carries with its addressing tags stripped — which is exactly what `firstCardFrame` quotes.
 *
 * @param brief the routing brief this dispatch is acting on
 * @returns the mention the capture poster would have been handed
 */
function mentionFromBrief({ brief }: { brief: TurnRoutingBrief }): Mention {
  return {
    channel: brief.channel,
    messageTs: brief.messageTs,
    surface: brief.surface,
    text: brief.question,
    threadTs: brief.threadTs,
    userId: brief.userId,
  };
}

/**
 * Post this ask's first card frame through the same wiring capture uses, resolving the token and the
 * supervisor only now, at the moment a post is genuinely needed.
 *
 * @param brief the routing brief the card hangs off and whose question it quotes
 * @param home the resolved state home
 * @param turnId the id `./ensureCard.ts` minted for this card
 * @returns the ts the card landed on
 */
async function postFirstCard({
  brief,
  home,
  turnId,
}: {
  brief: TurnRoutingBrief;
  home: string;
  turnId: string;
}): Promise<{ readonly ts: string }> {
  const token = slackBotToken({ home });
  if (token === undefined) {
    throw new Error("no Slack bot token — run `slopweaver connect slack` first");
  }
  const detection = detectSupervisorSession({ env: process.env });
  const checklist = liveCapturedChecklistDeps({
    doorLedger: doorLedgerPort(),
    home,
    log: ({ line }) => {
      logger.error({ msg: `turn dispatch: ${line}` });
    },
    supervisor: detection.kind === "active" ? detection.session : undefined,
    transport: makeSlackWriteTransport({ home, token }),
  });
  return checklist.postChecklist({
    mention: mentionFromBrief({ brief }),
    ...firstCardFrame({ question: brief.question }),
    turnId,
  });
}

/**
 * Edit this ask's proved card onto the frame a dispatched ask wears, through the same `advanceWorking`
 * primitive `turn status`, `turn watch`, `turn block` and the loop's own sweep all write with.
 *
 * Resolves its Slack wiring lazily for exactly the reason `postFirstCard` does — see this file's header. The
 * provenance is `preWorkerProvenance`, not `./cardGates.ts`'s `cardAuthorLabel`: this runs BEFORE the worker
 * is launched, so there is no dispatch record naming one yet.
 *
 * @param brief the routing brief the card hangs off and whose question the frame quotes
 * @param home the resolved state home
 * @param started the card this dispatch proved
 * @returns `"gone"` when Slack reports the card no longer exists, which the gate answers by posting a fresh one
 */
async function advanceToDispatchedFrame({
  brief,
  home,
  started,
}: {
  brief: TurnRoutingBrief;
  home: string;
  started: StartedChecklist;
}): Promise<"stands" | "gone"> {
  const token = slackBotToken({ home });
  if (token === undefined) {
    throw new Error("no Slack bot token — run `slopweaver connect slack` first");
  }
  const askIdentity = askIdentityOf({ source: brief });
  const posted = { channel: brief.channel, ts: started.workingTs };
  const transport = makeSlackWriteTransport({ home, token });
  const detection = detectSupervisorSession({ env: process.env });
  const advancer = liveChecklistAdvancer({
    askIdentity,
    doorLedger: doorLedgerPort(),
    home,
    provenance: preWorkerProvenance({ supervisor: detection.kind === "active" ? detection.session : undefined }),
    transport,
    turnChrome: turnChromeFrom({ chrome: chromeFromProfile({ home }) }),
    turnId: started.turnId,
  });
  // The log as it stands, so a RE-dispatch redraws the plan and stages already filed rather than wiping them.
  const { timeline } = readProgressLog({ askIdentity, home });
  return advancer.advanceWorking({ posted, ...dispatchedCardFrame({ question: brief.question, timeline }) }).then(
    () => "stands" as const,
    (error: unknown) => {
      if (isAlreadyGoneThrowable({ thrown: error })) {
        return "gone" as const;
      }
      throw error;
    },
  );
}

/**
 * Whether a card this ask may not write still stands, read rather than edited — the one path here that costs a
 * Slack read, and only a shared card whose writer is another open ask takes it. `thread_not_found` counts as
 * gone as well as `message_not_found`: the fallback read is `conversations.replies` anchored at the card's
 * own ts, and a deleted reply has no thread to anchor at. Any other failure rejects, and the gate reports it.
 *
 * @param brief the routing brief whose channel the card sits in
 * @param home the resolved state home, for the bot token
 * @param started the card to look for
 * @returns `"gone"` when neither read finds the message
 */
async function cardStandsByRead({
  brief,
  home,
  started,
}: {
  brief: TurnRoutingBrief;
  home: string;
  started: StartedChecklist;
}): Promise<"stands" | "gone"> {
  const token = slackBotToken({ home });
  if (token === undefined) {
    throw new Error("no Slack bot token — run `slopweaver connect slack` first");
  }
  const transport = makeSlackWriteTransport({ home, token });
  const posted = { channel: brief.channel, ts: started.workingTs };
  const found = await transport.readMessage({ posted }).then(
    (message) => message !== undefined,
    (error: unknown) => {
      const data = isRecord(error) ? error["data"] : undefined;
      const threadGone = isRecord(data) && data["error"] === "thread_not_found";
      if (threadGone || isAlreadyGoneThrowable({ thrown: error })) {
        return false;
      }
      throw error;
    },
  );
  return found ? "stands" : "gone";
}

/**
 * Build the live {@link LiveCardDeps} for one dispatch.
 *
 * Infallible by construction: the lifecycle read and the brief write need nothing external, and the one
 * thing that does — the post — resolves its own Slack wiring and rejects with the reason when it cannot.
 *
 * @param brief the routing brief, for the ask the card hangs off and the question it quotes
 * @param briefPath where the proven ref is written back, so every card verb downstream can read it
 * @param home the resolved state home
 * @returns the seams `ensureLiveCard` drives
 */
export function liveCardDeps({
  brief,
  briefPath,
  home,
}: {
  brief: TurnRoutingBrief;
  briefPath: string;
  home: string;
}): LiveCardDeps {
  return {
    advanceCard: ({ brief: target, started }) => advanceToDispatchedFrame({ brief: target, home, started }),
    mayWriteCard: ({ askIdentity, workingTs }) => mayWriteCardOnDisk({ askIdentity, home, workingTs }),
    mintTurnId: () => `turn-${String(Date.now())}`,
    parentCard: ({ askIdentity, parentMessageTs }) => parentCardOnDisk({ askIdentity, home, parentMessageTs }),
    persistStarted: ({ started }) => {
      writeBrief({ brief: { ...brief, started }, path: briefPath });
    },
    postCard: ({ brief: target, turnId }) => postFirstCard({ brief: target, home, turnId }),
    readCard: ({ brief: target, started }) => cardStandsByRead({ brief: target, home, started }),
    recordChecklistPosted: ({ askIdentity, started }) => {
      appendAskLifecycleEvent({
        event: {
          ...askIdentity,
          kind: "checklist-posted",
          tsIso: new Date().toISOString(),
          turnId: started.turnId,
          workingTs: started.workingTs,
        },
        home,
      });
    },
    recordedStarted: ({ askIdentity }) => startedRefForAsk({ askIdentity, home }),
  };
}

/**
 * The card a DISPATCHED worker is entitled to, resolved the way `ensureLiveCard` resolves one: the brief
 * first, then the ask's own lifecycle log.
 *
 * The second read is not belt-and-braces. A brief can be rebuilt for the same ask after its dispatch — the
 * subagent-report path in `./dispatchInitial.ts` names that window explicitly — and a rebuild carries no
 * `started`, while the card it named is still standing in the thread. `turn resume` refusing there would
 * stop a worker whose card is fine, which inverts the gate. `undefined` means no card exists anywhere, and
 * that IS the refusal.
 *
 * @param askIdentity the ask whose lifecycle log is the surviving record of its card
 * @param brief the brief this worker was dispatched on, as it stands on disk right now
 * @param home the resolved state home
 * @returns the card's ref, or `undefined` when this ask has none
 */
export function cardForWorker({
  askIdentity,
  brief,
  home,
}: {
  askIdentity: AskIdentity;
  brief: TurnRoutingBrief;
  home: string;
}): StartedChecklist | undefined {
  if (brief.started !== undefined) {
    return brief.started;
  }
  return startedRefForAsk({ askIdentity, home });
}
