/**
 * The WRITE half of the stranded lane: say so in the thread, spend the ask's one re-dispatch, hand the
 * survivor on to the same capture the socket listener gives a live tag.
 *
 * `../../../live/listen/stranded.ts` decides which asks qualify; `./strandedSurvivors.ts` reads their
 * messages back and classifies them; this is the only place that changes anything. It starts nothing — the
 * session running the pass is what goes on to answer — so AGENTS.md rule 2's visibility property is a
 * property of the CALLER, and the caller is `./scheduledRecover.ts`, which only ever runs inside the visible
 * loop session.
 *
 * ## The order is notice, then spend, then capture — and each step's failure means something different
 *
 * The notice goes first because it is the only thing the person waiting sees before the card reappears, and
 * a card that comes back with no explanation reads as the bot forgetting it already failed. It is
 * best-effort: a thread the door or Slack refuses still gets its answer, and the refusal is logged.
 *
 * The spend is appended BEFORE the capture, and that ordering is the bound. A session that dies between the
 * two has used this ask's one re-dispatch without answering it — accepted, and named in
 * `../../../live/listen/stranded.ts` — whereas appending afterwards would leave a session that dies mid-capture
 * re-admitting the same ask on every later pass, which is the retry loop rule 2 bans.
 */
import { randomUUID } from "node:crypto";

import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import type { DoorGate } from "../../../admit/types.js";
import type { SlackWriteTransport } from "../../../corpus/slack/writeTransport.js";
import { askIdentityOf } from "../../../live/ask/identity.js";
import { appendAskLifecycleEvent } from "../../../live/ask/store.js";
import type { RecoveryVerdict } from "../../../live/listen/recover.js";
import { redispatchNotice, type StrandedAsk } from "../../../live/listen/stranded.js";
import { noticeMetadata } from "../../../outbound/slack/noticeMetadata.js";
import type { StrandedScan } from "./strandedSurvivors.js";

/**
 * Where this lane's own narration goes — one line per thing that happened, never a throw.
 *
 * @internal
 */
export type StrandedPickupLog = (input: { line: string }) => void;

/**
 * Post the one sentence that tells the thread a session is picking this ask up again.
 *
 * Through the door like every other outbound write, and best-effort in every direction: a refusal, a Slack
 * error and a throw all leave the pickup itself standing, because an unexplained answer is still better than
 * no answer. Rule 7 is why it is one sentence — the failure card it corrects is directly above it in the
 * thread, and the working card is directly below.
 *
 * @param doorLedger where the door's decision is recorded before the notice is sent
 * @param home the resolved state home
 * @param log where the outcome is narrated
 * @param sendGates the gates this send is routed through
 * @param postReply the same `postDripMessage` seam every other plain message in this program goes out
 *   through — narrowed to the one method so nothing here can reach a second kind of write
 * @param stranded the ask being picked up
 */
async function postRedispatchNotice({
  doorLedger,
  home,
  log,
  postReply,
  sendGates,
  stranded,
}: {
  doorLedger: DoorLedgerPort;
  home: string;
  log: StrandedPickupLog;
  postReply: SlackWriteTransport["postDripMessage"];
  sendGates: readonly DoorGate[];
  stranded: StrandedAsk;
}): Promise<void> {
  const text = redispatchNotice({
    firstAnswered: stranded.firstAnswerIso !== undefined,
    strandedAs: stranded.strandedAs,
  });
  try {
    const routed = await throughDoor({
      gates: sendGates,
      home,
      ledger: doorLedger,
      perform: () =>
        postReply({
          channel: stranded.ask.channel,
          // Stamped so `slack delete` can retract it: a bare plain line was unretractable by any verb.
          payload: { form: "plain", metadata: noticeMetadata(), text, unfurl_links: false, unfurl_media: false },
          threadTs: stranded.ask.threadTs,
        }),
      request: {
        action: { kind: "verb", noun: "listen", verb: "redispatch-notice" },
        artifact: { channel: stranded.ask.channel, chars: text.length, threadTs: stranded.ask.threadTs },
        meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
      },
      runId: randomUUID(),
    });
    if (!routed.performed) {
      for (const line of notPerformedLines({ command: "posting the re-dispatch notice", through: routed })) {
        log({ line });
      }
      log({ line: "the re-dispatch notice was not posted — picking it up anyway" });
    }
  } catch (error) {
    log({ line: `posting the re-dispatch notice threw — picking it up anyway: ${String(error)}` });
  }
}

/**
 * Print one line for every ask this pass did NOT pick up: the two held-by-design kinds, then the refusals.
 *
 * BEFORE the refusals, and worded as a different thing, because it is one: an ask whose review record is
 * open was never a strand, so nothing about it was refused and nothing of its one attempt was spent. It
 * reaches no thread read, no notice, no `redispatched` row and no second turn — see
 * `../../../live/listen/stranded.ts`'s header for the turn that minted all four over a live worker.
 *
 * Same shape and same reason for a builder: one whose workspace is still alive has not vanished, and a
 * re-dispatch beside it would start a second build of the stack its plan promised. Printed every pass it
 * holds, so a builder that stopped without closing is visible rather than silently parked.
 */
function logUnpickedAsks({ log, scan }: { log: StrandedPickupLog; scan: StrandedScan }): void {
  for (const ask of scan.reviewOpen) {
    log({
      line:
        `recovery skipped: ${ask.channel}/${ask.messageTs} — IN REVIEW; the review record is open, ` +
        "so no re-dispatch was spent.",
    });
  }
  for (const ask of scan.builderRunning) {
    log({
      line:
        `recovery skipped: ${ask.channel}/${ask.messageTs} — BUILDING; its plan is posted and the workspace of ` +
        "the worker that posted it is still alive, so no re-dispatch was spent.",
    });
  }
  for (const refusal of scan.refused) {
    log({
      line:
        `stranded, not picked up: ${refusal.stranded.ask.channel}/${refusal.stranded.ask.messageTs} — ` +
        refusal.reason,
    });
  }
}

/**
 * Say so in-thread and spend each stranded survivor's one re-dispatch, and report every ask this pass did
 * NOT pick up.
 *
 * @param doorLedger where the notice's door decision is recorded
 * @param home the resolved state home
 * @param log where this lane's narration goes
 * @param nowIso the instant the spend records are stamped with
 * @param scan what `./strandedSurvivors.ts` found
 * @param postReply the `postDripMessage` seam the in-thread notice goes out through
 * @param sendGates the gates the in-thread notice is routed through
 * @returns the verdicts to hand to the ordinary survivor capture, oldest strand first
 */
export async function pickUpStrandedAsks({
  doorLedger,
  home,
  log,
  nowIso,
  postReply,
  scan,
  sendGates,
}: {
  doorLedger: DoorLedgerPort;
  home: string;
  log: StrandedPickupLog;
  nowIso: string;
  postReply: SlackWriteTransport["postDripMessage"];
  scan: StrandedScan;
  sendGates: readonly DoorGate[];
}): Promise<readonly RecoveryVerdict[]> {
  logUnpickedAsks({ log, scan });
  const verdicts: RecoveryVerdict[] = [];
  for (const survivor of scan.survivors) {
    const stranded = survivor.stranded;
    await postRedispatchNotice({ doorLedger, home, log, postReply, sendGates, stranded });
    appendAskLifecycleEvent({
      event: {
        ...askIdentityOf({ source: stranded.ask }),
        kind: "redispatched",
        reason: stranded.reason,
        strandedAs: stranded.strandedAs,
        tsIso: nowIso,
      },
      home,
    });
    log({
      line:
        `re-dispatching a stranded ask: ${stranded.ask.channel}/${stranded.ask.messageTs} — ` +
        `${stranded.strandedAs} for ${String(stranded.sinceMinutes)}m`,
    });
    verdicts.push(survivor.verdict);
  }
  return verdicts;
}
