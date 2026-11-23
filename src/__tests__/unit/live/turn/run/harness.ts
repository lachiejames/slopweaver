/*
 * The turn's ORDERING, driven by plain fakes.
 *
 * A turn is mostly a sequence claim — acknowledge before working, advance before answering, never tick a
 * step before it happened — so these tests record the exact call order and assert it. No mocks: the poster
 * and the query are function seams the production wiring fills with adapters and a test fills with
 * closures over an array. This module is that recording poster, the query fake and the drive helpers every
 * `runTurn` test file shares.
 */
import { err, ok, type Result, unwrap } from "#lib/result.js";

import type { Mention } from "../../../../../live/listen/mention.js";
import type { TurnAnswerCard } from "../../../../../live/turn/answer.js";
import type { CompletionSink, TurnCompletion } from "../../../../../live/turn/envelope.js";
import {
  type AnswerSendRefusal,
  AnswerSendRefusals,
  type HoldSink,
  type PostedRef,
  runTurn,
  type TurnPoster,
  type TurnProvenance,
  type TurnQuery,
  type TurnSupersession,
} from "../../../../../live/turn/run.js";
import type { ExecutionTier } from "../../../../../live/turn/tier.js";
import type { AnswerFormAnswer } from "../../../../../outbound/assistant/answerForm.js";
import { ANSWER, COVERAGE, PROVENANCE } from "./fixtures.js";

/** A completion sink that records nothing and never rejects — the default for tests not about durability. */
export const NULL_COMPLETE: CompletionSink = async () => {};

/**
 * A hold sink that files nothing and always answers with the same id.
 *
 * @returns the fixed queue id `q-test0000`
 */
export const NULL_HOLD: HoldSink = async () => ({ id: "q-test0000" });

/**
 * The supersession seam for every turn that is not about superseding anything.
 *
 * It reports `not-declared`, which is what the real one reports for an answer form carrying no `supersedes`
 * — so a test taking this is asserting over the same shape production hands back on the overwhelmingly
 * common turn. The cases that ARE about it pass their own, recording seam.
 *
 * @returns a `not-declared` outcome on every call
 */
export const NULL_SUPERSESSION: TurnSupersession = async () => ({ outcome: "not-declared" });

/**
 * One recorded interaction with Slack. `states` is the checklist as that frame rendered it; `ids` is which
 * STEPS it rendered — `states` alone cannot tell `PENDING_ROUTE_STEPS` apart from `VERB_TURN_STEPS`, since
 * both are two steps and both read `["done", "running"]` at the same cursor position.
 */
export interface Recorded {
  readonly kind:
    | "post-working"
    | "advance"
    | "delete-working"
    | "finalize"
    | "post-answer"
    | "post-notice"
    | "set-title"
    | "begin-status"
    | "reap"
    | "end-status"
    | "stop-status-reasserting"
    | "settle-reaction";
  readonly states?: readonly string[];
  readonly ids?: readonly string[];
  readonly details?: readonly (string | undefined)[];
  readonly lead?: string;
  /** The failure card's own prose — where the terminal reason lands, since the tldr is a fixed sentence. */
  readonly card?: TurnAnswerCard;
  readonly title?: string;
  readonly status?: string;
  readonly reaction?: string;
  /** The earlier card a reap targeted. */
  readonly ts?: string;
}

/**
 * The failure card's prose, flattened. The tldr is a fixed "I could not answer: <question>" sentence, so the
 * clause naming HOW the turn ended lives in the detail — which is the field a reader actually acts on.
 *
 * @param log the recorded poster interactions
 * @returns every text run in the last notice's detail, joined
 */
export function failureDetail({ log }: { log: readonly Recorded[] }): string {
  const card = log.findLast((entry) => entry.kind === "post-notice")!.card!;
  return JSON.stringify(card.artifact.detail);
}

/**
 * A recording poster. Not a mock — a plain object of closures over `log`.
 *
 * `withhold` is the door's verdict for this run's ANSWER, standing in for the judgement the live adapter
 * builds a gate from. A test that wants a withheld turn passes one; every other test leaves it absent and the
 * poster admits the answer, which is what the shipped default policy does.
 *
 * @returns a poster whose every call appends to `log` and answers as the named failure switches say
 */
// max-lines-exempt: one plain-object fake of the whole TurnPoster interface, its length that interface's, moved verbatim out of a test file this gate skips
export function recordingPoster({
  log,
  titleRefusal,
  statusRefusal,
  clearRefusal,
  statusThrows,
  withhold,
  deleteWorkingFails,
  finalizeWorkingFails,
  postAnswerThrows,
  postWorkingThrows,
  reactionRefusal,
  advanceGoneOnce,
  advanceThrows,
  warnRefusal,
  reapFails = [],
}: {
  log: Recorded[];
  /** The earlier-card timestamps whose delete cannot be confirmed. */
  reapFails?: readonly string[];
  /** The FIRST advance fails as Slack's `message_not_found` — the remembered capture-time message is gone. */
  advanceGoneOnce?: boolean;
  /** Every advance fails with this — a failure that is NOT the message being gone. */
  advanceThrows?: Error;
  titleRefusal?: string;
  statusRefusal?: string;
  clearRefusal?: string;
  statusThrows?: string;
  withhold?: { readonly code: string; readonly reason: string };
  deleteWorkingFails?: boolean;
  finalizeWorkingFails?: boolean;
  postAnswerThrows?: Error;
  /** postWorking throws this — the FIRST Slack write failing, which `beginTurn` never catches itself. */
  postWorkingThrows?: Error;
  reactionRefusal?: string;
  /** The door refuses this send with WARN-tier findings only — the ending that is not one. */
  warnRefusal?: string;
}): TurnPoster {
  const ref: PostedRef = { channel: "C1", ts: "1712345678.000300" };
  let advances = 0;
  return {
    advanceWorking: async ({ steps }) => {
      advances += 1;
      if (advanceThrows !== undefined) {
        throw advanceThrows;
      }
      if (advanceGoneOnce === true && advances === 1) {
        throw Object.assign(new Error("An API error occurred: message_not_found"), {
          data: { error: "message_not_found", ok: false },
        });
      }
      log.push({
        details: steps.map((step) => step.detail),
        ids: steps.map((step) => step.id),
        kind: "advance",
        states: steps.map((step) => step.state),
      });
    },
    beginStatus: async ({ status }) => {
      log.push({ kind: "begin-status", status });
      if (statusThrows !== undefined) {
        throw new Error(statusThrows);
      }
      return statusRefusal === undefined ? ok(undefined) : err(statusRefusal);
    },
    deleteWorking: async () => {
      log.push({ kind: "delete-working" });
      return deleteWorkingFails !== true;
    },
    endStatus: async () => {
      log.push({ kind: "end-status" });
      return clearRefusal === undefined ? ok(undefined) : err(clearRefusal);
    },
    finalizeWorking: async ({ steps }) => {
      log.push({
        details: steps.map((step) => step.detail),
        kind: "finalize",
        states: steps.map((step) => step.state),
      });
      return finalizeWorkingFails !== true;
    },
    postAnswer: async ({ answer }) => {
      log.push({ kind: "post-answer", lead: answer.lead });
      if (postAnswerThrows !== undefined) {
        throw postAnswerThrows;
      }
      if (warnRefusal !== undefined) {
        return { kind: "retryable-refusal", refusal: AnswerSendRefusals.warnRefused({ message: warnRefusal }) };
      }
      return withhold === undefined
        ? { kind: "posted", missingMedia: [], ref: { channel: "C1", ts: "1712345678.000400" } }
        : { code: withhold.code, kind: "withheld", reason: withhold.reason };
    },
    // A plain fake of the identity door: one id it knows, everything else absent, which is exactly the two
    // arms `questionForPlainField` has to render differently.
    displayNames: ({ slackIds }) =>
      Object.fromEntries(slackIds.filter((id) => id === "U_KNOWN").map((id) => [id, "Ada"])),
    ownerMention: "owner",
    postNotice: async ({ card }) => {
      log.push({ card, kind: "post-notice", lead: card.artifact.tldr });
      return { channel: "C1", ts: "1712345678.000500" };
    },
    reapEarlierCard: async ({ posted }) => {
      log.push({ kind: "reap", ts: posted.ts });
      return !reapFails.includes(posted.ts);
    },
    postWorking: async ({ steps }) => {
      log.push({
        details: steps.map((step) => step.detail),
        kind: "post-working",
        states: steps.map((step) => step.state),
      });
      if (postWorkingThrows !== undefined) {
        throw postWorkingThrows;
      }
      return ref;
    },
    setTitle: async ({ title }) => {
      log.push({ kind: "set-title", title });
      return titleRefusal === undefined ? ok(undefined) : err(titleRefusal);
    },
    settleReaction: async ({ reaction }) => {
      log.push({ kind: "settle-reaction", reaction });
      return reactionRefusal === undefined ? ok(undefined) : err(reactionRefusal);
    },
    stopStatusReasserting: () => {
      log.push({ kind: "stop-status-reasserting" });
    },
  };
}

/**
 * A query that reports `phases` phase boundaries and then answers.
 *
 * @param phases each phase detail reported before answering, in order
 * @returns a query seam that walks those phases and then hands back `answer`
 */
export function fakeQuery({
  phases,
  answer = ANSWER,
}: {
  phases: readonly string[];
  answer?: AnswerFormAnswer;
}): TurnQuery {
  return async ({ onPhase }) => {
    for (const detail of phases) {
      await onPhase({ detail });
    }
    return { answer, completionDetail: "answered via `slopweaver fleet status`", coverage: COVERAGE };
  };
}

/**
 * Drive one turn with the seams a caller must always supply, so a test states only what it is about.
 *
 * A test that IS about withholding passes its own `hold`; the rest take a sink that files nothing, because a
 * turn which is never withheld never reaches it and a test that pretended otherwise would be asserting the
 * helper rather than the code.
 *
 * @returns the turn's completion, or the warn-tier refusal that left it unended
 */
export async function driveRaw({
  mention,
  poster,
  query,
  complete = NULL_COMPLETE,
  hold = NULL_HOLD,
  provenance = PROVENANCE,
  tier,
  earlierCards = [],
  supersession = NULL_SUPERSESSION,
}: {
  mention: Mention;
  poster: TurnPoster;
  query: TurnQuery;
  earlierCards?: readonly PostedRef[];
  complete?: CompletionSink;
  hold?: HoldSink;
  provenance?: TurnProvenance;
  supersession?: TurnSupersession;
  tier?: ExecutionTier;
}): Promise<Result<TurnCompletion, AnswerSendRefusal>> {
  return runTurn({
    documents: [],
    earlierCards,
    supersession,
    complete,
    hold,
    mention,
    poster,
    provenance,
    query,
    turnId: "turn-test",
    uploads: [],
    ...(tier === undefined ? {} : { tier }),
  });
}

/**
 * {@link driveRaw}, unwrapped — the shape every test that is not about a warn-tier refusal wants.
 *
 * `unwrap` rather than a conditional: a turn that came back as an `Err` here has not ended at all, so a test
 * asserting over its completion is asserting over something that does not exist, and throwing with the door's
 * own message says that instead of reporting a missing field three lines later.
 *
 * @returns the turn's completion, throwing when it came back as a refusal
 */
export async function drive(input: Parameters<typeof driveRaw>[0]): Promise<TurnCompletion> {
  return unwrap(await driveRaw(input));
}
