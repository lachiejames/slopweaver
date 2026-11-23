/**
 * `slopweaver listen` — the responder-refusal handler: what happens when a mention comes from someone not on
 * the responder whitelist.
 *
 * Split out of {@link ./run.js} (the file-size ratchet, step 2). Two door decisions and one shared `runId`:
 * an audit-only hold that records who was refused and why, then a separate send that posts the fixed refusal
 * reply — see {@link responderRefusalHandler}'s own header for why they are kept apart.
 */

import { randomUUID } from "node:crypto";

import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import type { DoorGate } from "../../../admit/types.js";
import type { SlackWriteTransport } from "../../../corpus/slack/writeTransport.js";
import type { Mention } from "../../../live/listen/mention.js";
import type { ListenLog, ResponderRefusalHandler } from "../../../live/listen/socket.js";
import { type ResponderWhitelist, responderRefusalText } from "../../../live/listen/whitelist.js";
import { chromeFromProfile } from "../slack/wiring.js";

/**
 * The seams a responder refusal's two durable effects need. Separate from `ListenDeps` because a
 * refusal is a second, independent action a mention can trigger — not a variant of the ordinary handler.
 */
export interface ResponderRefusalDeps {
  /** Where both door decisions are recorded before anything is performed. */
  readonly doorLedger: DoorLedgerPort;
  readonly home: string;
  readonly log: ListenLog;
  /** The owner's Slack user id from the profile, or `null` when it does not resolve. Read fresh each call. */
  readonly ownerUserId: () => string | null;
  /** The same transport `capturingHandler` posts with — one Slack identity, one client, for everything. */
  readonly postReply: SlackWriteTransport["postDripMessage"];
  /**
   * The responder gate's LIVE state, for the reply's own population claim — read fresh each call, never the
   * admission decision's own (possibly long-cached) copy, so the copy never repeats the stale, hardcoded
   * "only takes direction from the owner" claim once a second identity is on the list.
   */
  readonly responderWhitelist: () => ResponderWhitelist;
  /** The gates the SEND decision runs through. `DEFAULT_GATES` in production; a test injects its own. */
  readonly sendGates: readonly DoorGate[];
}

/** Door call 1: the audit-only hold. Never performs anything — its one gate always fires. */
async function recordRefusalAuditHold({
  deps,
  mention,
  runId,
  why,
}: {
  deps: ResponderRefusalDeps;
  mention: Mention;
  runId: string;
  why: string;
}): Promise<void> {
  try {
    const held = await throughDoor({
      gates: [
        () => [
          {
            code: "responder.whitelist",
            correction: "add the exact Slack user id to responders.json under $SLOPWEAVER_HOME",
            severity: "hold",
            summary: why,
          },
        ],
      ],
      home: deps.home,
      ledger: deps.doorLedger,
      perform: () => undefined,
      request: {
        action: { kind: "verb", noun: "listen", verb: "responder-refusal" },
        artifact: { channel: mention.channel, threadTs: mention.threadTs, userId: mention.userId },
        meta: { createsWorkItem: false, effect: "none", home: deps.home, requiresApproval: false },
      },
      runId,
    });
    if (held.kind === "recording-refused") {
      deps.log({
        line: `could not record the responder-refusal audit hold — continuing to the reply: ${held.error.message}`,
      });
    }
  } catch (error) {
    deps.log({ line: `could not record the responder-refusal audit hold — continuing to the reply: ${String(error)}` });
  }
}

/** Door call 2: the actual send — the only one of the pair that can post anything. */
async function sendRefusalReply({
  deps,
  mention,
  runId,
}: {
  deps: ResponderRefusalDeps;
  mention: Mention;
  runId: string;
}): Promise<void> {
  const text = responderRefusalText({
    botLabel: chromeFromProfile({ home: deps.home }).authorLabel,
    ownerUserId: deps.ownerUserId(),
    whitelist: deps.responderWhitelist(),
  });
  try {
    const routed = await throughDoor({
      gates: deps.sendGates,
      home: deps.home,
      ledger: deps.doorLedger,
      perform: () =>
        deps.postReply({
          channel: mention.channel,
          payload: { form: "plain", text, unfurl_links: false, unfurl_media: false },
          threadTs: mention.threadTs,
        }),
      request: {
        action: { kind: "verb", noun: "listen", verb: "refusal-reply" },
        artifact: { channel: mention.channel, chars: text.length, threadTs: mention.threadTs },
        meta: { createsWorkItem: false, effect: "external-write", home: deps.home, requiresApproval: false },
      },
      runId,
    });
    if (!routed.performed) {
      const refusal = notPerformedLines({ command: "posting the responder-refusal reply", through: routed });
      for (const line of refusal) {
        deps.log({ line });
      }
      return;
    }
    deps.log({ line: `refusal reply posted in ${routed.result.channel} thread ${mention.threadTs}` });
  } catch (error) {
    deps.log({ line: `posting the responder-refusal reply threw — the identity remains refused: ${String(error)}` });
  }
}

/**
 * Build the responder-refusal handler: TWO door decisions and one shared `runId`, never one.
 *
 * The audit-only hold records WHO was refused and WHY, with nothing performed — `perform` is unreachable by
 * the door's own contract, because its one gate always fires a `hold`. The second, separate call is the only
 * thing that actually posts: a fixed, deterministic reply through the SAME `postDripMessage` path every other
 * plain message in this program goes out through. Sharing one `runId` between the two calls is what lets the
 * door ledger's audit line and send line read as one event rather than two unrelated ones.
 *
 * Both effects are attempted best-effort — a failure in one does not cancel the other, and neither is a
 * throw the caller has to catch. The identity is refused regardless of how either effect turns out.
 *
 * @param deps the seams this handler drives
 * @returns the handler `consumeMentions` calls on every whitelist refusal
 */
export function responderRefusalHandler({ deps }: { deps: ResponderRefusalDeps }): ResponderRefusalHandler {
  return async ({ mention, why }) => {
    const runId = randomUUID();
    await recordRefusalAuditHold({ deps, mention, runId, why });
    await sendRefusalReply({ deps, mention, runId });
  };
}
