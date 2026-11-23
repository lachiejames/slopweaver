/**
 * What `slopweaver turn answer` says once a turn has settled, and the exit code it earns — split out of
 * `./postAnswer.ts` because it runs after every gate and every effect there, and shares none of their wiring.
 */
import { logger } from "../../../lib/logger.js";
import { appendAskLifecycleEvent } from "../../../live/ask/store.js";
import type { Mention } from "../../../live/listen/mention.js";
import { lifecycleEventForCompletion } from "../../../live/turn/completionLifecycle.js";
import type { TurnCompletion } from "../../../live/turn/envelope.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";

/**
 * Narrate the turn's durable completion, record it in the ask-lifecycle log, surface whatever was queued
 * behind it, and choose the exit code.
 *
 * A withheld turn exits OK, and that is the decision worth having its own function. It did exactly what it
 * was asked to do — composed a reply, judged it, held it, and said so in the thread — so an operator who
 * scripts this verb must not have the mechanism working read as the tool breaking.
 *
 * @param completion the turn's durable outcome
 * @param home the state home whose ask-lifecycle log records it
 * @param mention the ask being reported on
 * @returns the process exit code
 */
export function reportAnswerOutcome({
  completion,
  home,
  mention,
}: {
  completion: TurnCompletion;
  home: string;
  mention: Mention;
}): number {
  const event = lifecycleEventForCompletion({ completion, tsIso: new Date().toISOString() });
  appendAskLifecycleEvent({ event, home });
  for (const secondary of completion.secondaryFailures) {
    // Verbatim, one line per failure: `reason` already says WHICH half failed — a title, a status set, a
    // status clear, or a checklist — and prefixing here once claimed "not set" over a message that said
    // "not cleared".
    logger.error({ msg: secondary.reason });
  }
  const outcome = outcomeReport({ completion, mention });
  if (outcome.stream === "error") {
    logger.error({ msg: outcome.line });
  } else {
    logger.out({ line: outcome.line });
  }
  return outcome.code;
}

/**
 * What this verb SAYS about a settled turn, and the exit code it earns — pure, so every arm is a plain call.
 *
 * Split out of {@link reportAnswerOutcome} rather than inlined because it is the one part of that function with
 * no I/O in it at all: four arms of a discriminated union, each a fixed sentence. A `switch` with a `never`-typed
 * default is what makes a fifth `TurnPrimaryOutcome` arm a compile error here rather than a silent fallthrough
 * to the answered line — the arrangement `.claude/rules/error-handling.md` asks for on an exhaustive branch.
 *
 * `answer-lost` is worded APART from `failed` on purpose, and that wording is the point of the whole
 * distinction: the operator reading it has an answered question and a broken send, so the next move is to
 * run the turn again — never to work out whether the ask was answerable at all.
 *
 * @internal — exported for its own unit tests; {@link reportAnswerOutcome} is the only production caller.
 * @param completion the turn's durable outcome
 * @param mention the ask being reported on, for the answered line's channel and thread
 * @returns the line to print, which stream it belongs on, and the process exit code
 */
export function outcomeReport({ completion, mention }: { completion: TurnCompletion; mention: Mention }): {
  readonly code: number;
  readonly line: string;
  readonly stream: "out" | "error";
} {
  const primary = completion.primary;
  switch (primary.kind) {
    case "withheld":
      return {
        code: EXIT_OK,
        line:
          `held for review, nothing sent — queued as ${primary.held.id}: ${primary.held.reason}\n` +
          `read it with \`slopweaver queue show ${primary.held.id}\`, send it with ` +
          `\`slopweaver queue release ${primary.held.id}\``,
        stream: "out",
      };
    case "failed":
      return { code: EXIT_ERROR, line: `turn did not answer: ${primary.reason}`, stream: "error" };
    case "answer-lost":
      return {
        code: EXIT_ERROR,
        line: `turn composed an answer and lost it on the way out — re-run the turn: ${primary.reason}`,
        stream: "error",
      };
    case "answered":
      return {
        code: EXIT_OK,
        line:
          `answered in ${mention.channel} thread ${mention.threadTs} — ` +
          `working ${completion.workingTs}, answer ${primary.answerTs}`,
        stream: "out",
      };
    case "first-answered":
      return {
        code: EXIT_OK,
        line:
          `first answer posted in ${mention.channel} thread ${mention.threadTs} — answer ${primary.answerTs}; ` +
          `this workspace stays open and the dispatch is still yours; you still owe: ${primary.followThrough.what}`,
        stream: "out",
      };
    default: {
      const unreachable: never = primary;
      return unreachable;
    }
  }
}
