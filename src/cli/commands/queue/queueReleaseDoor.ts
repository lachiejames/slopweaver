/*
 * The one module that may mark a queue entry released.
 *
 * A release replays the original withhold and then supplies the token that waives it, so the ledger reads
 * "this was held, and then a human released it" rather than showing an ordinary send. The queue event is
 * appended only AFTER the door confirms the post, so a refused or failed release leaves the entry `held`
 * and releasable.
 *
 * That ordering used to be a comment. It is a structure now: neither send path imports
 * `../../../admit/queueStore.js` or the Slack transport, so neither can post a message or record a send that
 * did not happen. Each renders its own payload and hands it here.
 */
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { type QueueItem } from "../../../admit/queue.js";
import { appendQueueEvent } from "../../../admit/queueStore.js";
import type { DoorRequest } from "../../../admit/types.js";
import { REPLY_ARTIFACT_FIELD, WITHHOLD_OVERRIDE, withholdGate } from "../../../admit/withhold.js";
import { slackBotToken } from "../../../config.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { runAssistantCompositeSend } from "../../../corpus/slack/writeSend.js";
import type { SlackUpload } from "../../../corpus/slack/writeTransport.js";
import { logger } from "../../../lib/logger.js";
import type { SlackAssistantAnswerPayload } from "../../../outbound/slack/types.js";
import { imageAdmitFor } from "../../../visualEvidence/prepareUploads.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { liveReadiness } from "../slack/uploadReadiness.js";

/**
 * The door request a release replays.
 *
 * It carries the same reply context the original answer did, so the same gate fires on the same finding —
 * which is what makes the override in the ledger legible as "this specific withhold was waived" rather than
 * as an unexplained token.
 */
function releaseRequest({ home, item }: { home: string; item: QueueItem }): DoorRequest {
  return {
    action: { kind: "verb", noun: "queue", verb: "release" },
    artifact: {
      channel: item.held.channel,
      queueId: item.id,
      [REPLY_ARTIFACT_FIELD]: {
        askedBy: item.held.askedBy,
        channel: item.held.channel,
        draftTldr: "",
        question: item.held.question,
        surface: item.held.surface,
      },
    },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}

/** The release note, stating an edit when one happened so the log never implies the draft went out as-is. */
function releaseNote({
  note,
  replacement,
}: {
  note: string;
  replacement: Readonly<Record<string, unknown>> | undefined;
}): string {
  const edited = replacement === undefined ? "" : "[edited: released a --form replacement, not the stored draft] ";
  return `${edited}${note}`;
}

/**
 * Send the release through the door with the withhold waived, and resolve the entry.
 *
 * The queue event is appended only AFTER the door confirms the post, so a refused or failed release leaves
 * the entry `held` and releasable — the opposite order would mark a draft sent that never went out, which is
 * the one thing a queue must not do.
 */
async function releaseThroughDoor({
  home,
  item,
  note,
  perform,
  replacement,
}: {
  home: string;
  item: QueueItem;
  note: string;
  perform: () => Promise<{ readonly channel: string; readonly ts: string }>;
  replacement: Readonly<Record<string, unknown>> | undefined;
}): Promise<number> {
  const outcome = await throughDoor({
    // The judgement is the RECORDED verdict, not a fresh one: a release waives the decision that was actually
    // made, and re-judging here would let a policy change between hold and release silently alter what the
    // ledger says was overridden.
    env: { ...process.env, SLOPWEAVER_DOOR_OVERRIDE: WITHHOLD_OVERRIDE },
    gates: [withholdGate({ judge: () => ({ code: item.held.code, kind: "withhold", reason: item.held.reason }) })],
    home,
    ledger: doorLedgerPort(),
    perform,
    request: releaseRequest({ home, item }),
  });
  if (!outcome.performed) {
    const refusal = notPerformedLines({ command: `slopweaver queue release ${item.id}`, through: outcome });
    for (const line of refusal) {
      logger.error({ msg: line });
    }
    return EXIT_ERROR;
  }
  appendQueueEvent({
    // The substitution is recorded on the event, never left implicit: a queue that showed the composed draft
    // beside a `released` state would claim THAT text went out when something else did.
    event: { id: item.id, kind: "released", note: releaseNote({ note, replacement }), tsIso: new Date().toISOString() },
    home,
  });
  logger.out({
    line:
      `released ${item.id} — posted to ${outcome.result.channel} at ${outcome.result.ts}. The door recorded ` +
      `\`${item.held.code}\` as OVERRIDDEN, so the ledger shows a waived withhold rather than an ordinary send.`,
  });
  return EXIT_OK;
}

/**
 * Preview or post one rendered payload, and record the release only if the door confirms it.
 *
 * Both release shapes end here, and that is what keeps them identical on the wire: the same dry-run print,
 * the same token check, the same transport, the same composite send. They differ only in what they attach,
 * so an answer form passes its uploads and documents and a card artifact passes none.
 *
 * Neither shape module imports the transport or the queue store, so neither can post a message or record a
 * release without coming through here.
 *
 * @param payload already through the accent-only answer wrapper, never the operator card renderer
 * @param replacement the substituted draft a `--form` supplied, recorded on the release event
 * @returns the verb's exit code
 */
export async function postReleasedPayload({
  documents,
  dryRun,
  home,
  item,
  note,
  payload,
  replacement,
  uploads,
}: {
  documents: readonly SlackUpload[];
  dryRun: boolean;
  home: string;
  item: QueueItem;
  note: string;
  payload: SlackAssistantAnswerPayload;
  replacement: Readonly<Record<string, unknown>> | undefined;
  uploads: readonly SlackUpload[];
}): Promise<number> {
  if (dryRun) {
    logger.out({ line: `would post to ${item.held.channel} thread ${item.held.threadTs}:` });
    logger.out({ line: JSON.stringify(payload, null, 2) });
    return EXIT_OK;
  }
  const token = slackBotToken({ home });
  if (token === undefined) {
    logger.error({ msg: "no Slack bot token — run `slopweaver connect slack` first" });
    return EXIT_ERROR;
  }
  const transport = makeSlackWriteTransport({ home, token });
  const admit = imageAdmitFor({ env: process.env, home, nowIso: new Date().toISOString() });
  return releaseThroughDoor({
    home,
    item,
    note,
    perform: () =>
      runAssistantCompositeSend({
        admit,
        channel: item.held.channel,
        documents,
        payload,
        readiness: liveReadiness({ token }),
        threadTs: item.held.threadTs,
        transport,
        uploads,
      }),
    replacement,
  });
}
