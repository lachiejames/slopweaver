/**
 * Turn a rotation decision into a supervisor-stream event. Pure — the caller owns the clock and the write.
 *
 * There is no second reporting channel here on purpose. The supervisor stream already exists so the
 * supervisor is TOLD rather than made to ask, and its severity ordering already drives
 * `events tail --min-severity alert`, which is what catches something even when nobody runs a check. A
 * rotation that published to its own file would be invisible to exactly the reader it needs.
 *
 * The severity split is the part that matters. A `rotated` event is bookkeeping and stays `info`. The other
 * two are `alert` because neither clears itself on the next tick: `all-exhausted` waits on a provider reset
 * nothing here can hurry, and `gauge-unreadable` means the rate-limit shape changed underneath us, so
 * rotation has stopped choosing at all rather than guessing.
 *
 * **Nothing built here can carry a credential**, and that is a property of the input rather than a habit of
 * this file: a {@link ClaudeRotationDecision} names aliases and instants, and an alias is a neutral local
 * label by construction (`config.ts` refuses anything else). These strings are printed into a terminal, a
 * sidebar row and a briefing.
 */
import type { ClaudeRotationStreamEvent } from "../events/event.js";
import type { ClaudeRotationDecision } from "./contracts.js";
import type { ClaudeRotationError } from "./errors.js";

/** How many excluded plans a `why` sentence names before it stops listing them. */
const NAMED_EXCLUSIONS = 3;

/**
 * A readable list of why plans were held out, capped so one sentence stays one sentence.
 *
 * @param excluded every plan held out of selection, with its reason
 * @returns the joined phrase, or an empty string when nothing was excluded
 */
function excludedPhrase({ excluded }: { excluded: readonly { alias: string; reason: string }[] }): string {
  if (excluded.length === 0) {
    return "";
  }
  const named = excluded.slice(0, NAMED_EXCLUSIONS).map((entry) => `${entry.alias} (${entry.reason})`);
  const rest = excluded.length - named.length;
  const tail = rest > 0 ? `, and ${String(rest)} more` : "";
  return `${named.join(", ")}${tail}`;
}

/**
 * Build the event a completed decision should publish, or undefined when the decision says to stay put.
 *
 * A `stay` publishes nothing at all. The stream is read by a person, and an event per cycle saying the
 * fleet did not move is the kind of noise that trains a reader to skim past the alerts beside it.
 *
 * @param decision what the selection pass concluded
 * @param nowIso the instant to stamp, ISO-8601 — injected, never read from a hidden clock
 * @returns the event to append, or undefined when there is nothing worth saying
 */
export function rotationEvent({
  decision,
  nowIso,
}: {
  decision: ClaudeRotationDecision;
  nowIso: string;
}): ClaudeRotationStreamEvent | undefined {
  if (decision.kind === "stay") {
    return undefined;
  }
  if (decision.kind === "rotate") {
    const left = decision.from === undefined ? "" : ` off ${decision.from}`;
    const held = excludedPhrase({ excluded: decision.excluded });
    const because = held === "" ? "" : ` — held out: ${held}`;
    return {
      alias: decision.to,
      atIso: nowIso,
      earliestResetIso: undefined,
      fromAlias: decision.from,
      kind: "rotated",
      source: "claude-rotation",
      why: `the fleet moved${left} onto ${decision.to}${because}`,
    };
  }
  const back =
    decision.earliestResetIso === undefined ? "no reset is known" : `earliest reset ${decision.earliestResetIso}`;
  return {
    alias: undefined,
    atIso: nowIso,
    earliestResetIso: decision.earliestResetIso,
    fromAlias: undefined,
    kind: "all-exhausted",
    why: `every plan is spent, so nothing rotated — ${back}. Held out: ${excludedPhrase({ excluded: decision.excluded })}`,
    source: "claude-rotation",
  };
}

/**
 * Build the alert for a gauge this build cannot read.
 *
 * Its own kind rather than a variant of `all-exhausted`, because the two mean opposite things to a reader:
 * every plan being spent is the system working, and an unreadable gauge is the system declining to guess.
 *
 * @param error the typed failure a gauge read produced
 * @param nowIso the instant to stamp, ISO-8601
 * @returns the alert to append
 */
export function gaugeUnreadableEvent({
  error,
  nowIso,
}: {
  error: ClaudeRotationError;
  nowIso: string;
}): ClaudeRotationStreamEvent {
  return {
    alias: undefined,
    atIso: nowIso,
    earliestResetIso: undefined,
    fromAlias: undefined,
    kind: "gauge-unreadable",
    source: "claude-rotation",
    why: `rotation stopped choosing: ${error.message}`,
  };
}
