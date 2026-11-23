/**
 * What `slopweaver turn review` is reviewing: the answer's origin, resolved from either of the verb's two
 * flag forms — the worker's `--dispatch <id>`, or the loop's own `--brief`/`--decision` pair.
 *
 * Split from `./review.ts` on size alone; that module's header explains the verb.
 */

import { readFileSync } from "node:fs";

import { err, ok, type Result } from "../../../lib/result.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import { type TurnRoutingBrief } from "../../../live/turn/brief.js";
import { readBrief } from "../../../live/turn/briefStore.js";
import { askIdentityFromDispatchId, type FreshDispatchRecord } from "../../../live/turn/dispatch.js";
import { currentGenerationDispatchRecord, noDispatchRecordReason } from "../../../live/turn/dispatchStore.js";

import { parseRoutingDecision } from "../../../live/turn/judgement.js";

import { reviewPartyName } from "../../../live/turn/review.js";

import type { FreshVisibleSessionRef, RespondDecision } from "../../../live/turn/tier.js";

import { detectSupervisorSession } from "../../../supervisor/session.js";
import { type TurnCommandError, TurnCommandErrors } from "./errors.js";

/**
 * Read and JSON-parse a file, naming what it was for in the failure.
 *
 * @returns the parsed value, or the reason it could not be read or parsed
 */
export function readJson({ path, what }: { path: string; what: string }): Result<unknown, TurnCommandError> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return err(TurnCommandErrors.fileUnreadable({ cause: error, path, what }));
  }
  try {
    return ok(JSON.parse(text));
  } catch (error) {
    return err(TurnCommandErrors.documentNotJson({ cause: error, what }));
  }
}

/** Everything the open mode needs about the answer's origin, resolved from either flag form. */
export interface ReviewSubject {
  readonly askIdentity: AskIdentity;
  readonly askPermalink: string | undefined;
  readonly authorSession: string;
  readonly brief: TurnRoutingBrief;
  readonly briefPath: string;
  readonly decision: RespondDecision;
  readonly host: FreshVisibleSessionRef["host"];
}

/**
 * The subject for the worker's form — everything comes off the durable dispatch record.
 *
 * @returns the resolved subject, or why the dispatch record could not supply one
 */
export function dispatchSubject({
  dispatchId,
  home,
}: {
  dispatchId: string;
  home: string;
}): Result<ReviewSubject, TurnCommandError> {
  const askIdentity = askIdentityFromDispatchId({ dispatchId });
  if (askIdentity === undefined) {
    return err(TurnCommandErrors.dispatchTokenInvalid({ dispatchId }));
  }
  const record: FreshDispatchRecord | undefined = currentGenerationDispatchRecord({ askIdentity, home });
  if (record === undefined) {
    return err(
      TurnCommandErrors.dispatchRecordMissingBecause({
        dispatchId,
        reason: noDispatchRecordReason({ askIdentity, home }),
      }),
    );
  }
  const brief = readBrief({ path: record.briefPath });
  if (brief.isErr()) {
    return err(TurnCommandErrors.upstreamRefused({ reasons: [brief.error.message] }));
  }
  return ok({
    askIdentity,
    askPermalink: record.askPermalink,
    authorSession: reviewPartyName({ role: "author", session: record.session }),
    brief: brief.value,
    briefPath: record.briefPath,
    decision: record.decision,
    host: record.session.host,
  });
}

/**
 * The subject for the loop's own form — a brief and a decision file, the author being this session.
 *
 * @returns the resolved subject, or why the brief or decision could not supply one
 */
export function briefSubject({
  briefPath,
  decisionPath,
}: {
  briefPath: string;
  decisionPath: string;
}): Result<ReviewSubject, TurnCommandError> {
  const brief = readBrief({ path: briefPath });
  if (brief.isErr()) {
    return err(TurnCommandErrors.upstreamRefused({ reasons: [brief.error.message] }));
  }
  const raw = readJson({ path: decisionPath, what: "decision" });
  if (raw.isErr()) {
    return err(raw.error);
  }
  const decision = parseRoutingDecision({ value: raw.value });
  if (decision.isErr()) {
    return err(TurnCommandErrors.upstreamRefused({ reasons: decision.error }));
  }
  if (decision.value.response !== "respond") {
    return err(TurnCommandErrors.decisionNotRespondable({ purpose: "review" }));
  }
  const detection = detectSupervisorSession({ env: process.env });
  const authorSession =
    detection.kind === "active"
      ? `author ${detection.session.host} session ${detection.session.id}`
      : "author: the composing session (no visible session id in this environment)";
  return ok({
    askIdentity: { channel: brief.value.channel, messageTs: brief.value.messageTs, threadTs: brief.value.threadTs },
    askPermalink: undefined,
    authorSession,
    brief: brief.value,
    briefPath,
    decision: decision.value,
    host: brief.value.routingInput.execution.supervisorHost,
  });
}
