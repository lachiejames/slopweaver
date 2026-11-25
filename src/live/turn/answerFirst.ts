/**
 * ANSWER FIRST, TOOL SECOND — the rule a dispatched worker on a public ask is held to, as a pure decision.
 *
 * ## The measurement
 *
 * Ask `C0SYN000006`/`1789952379.135579`, a direct instruction to the bot in a public `#dev-alerts`
 * thread, captured and dispatched a minute later. The worker read it correctly and
 * went straight at the engineering: more than two hours in it had opened, pushed, self-reviewed
 * and landed a composer pull request. The first thing the channel heard from it was the answer — two hours and
 * thirty-eight minutes after the ask, and TWELVE MINUTES AFTER the owner asked, in front of the team,
 * what was happening in the thread.
 *
 * Nothing the worker did was wrong on its own. The composer change was the right change, it landed, and
 * three review rounds caught real defects in the answer that followed. What was wrong was the ORDER: a
 * colleague watching a public thread cannot see a branch, and a pull request is not an answer.
 *
 * ## What this module decides, and what it deliberately does not
 *
 * It answers one question — is this session the dispatched worker for a PUBLIC ask that has not been
 * answered yet? — over state a caller has already read. It knows nothing about pull requests; the door
 * that opens one (`../../cli/commands/github/answerFirstGate.ts`, on `github stack push`) is what turns
 * this verdict into a refusal, and `./briefGuidance.ts` is what tells the worker the rule before it ever
 * reaches that door.
 *
 * ## Why `dispatched && !firstAnswered` means "no answer yet"
 *
 * `../ask/lifecycle.ts`'s `supersedesDispatch` clears an ask's `activeDispatch` on every terminal —
 * `answered` included. The one answer that does NOT clear it is the one this rule asks for: a FIRST answer
 * posted with follow-through owed (`first-answered`), which keeps the dispatch so the worker that posted it
 * survives to open the pull request. So the held condition is the dispatch AND no first answer on the fold —
 * both derived, neither restated. A `state !== "answered"` test would be a weaker copy of the same fact, and
 * would go stale the moment a new kind lands.
 */

import { elapsedWords } from "./progressCard.js";

/**
 * One ask, reduced to exactly what this rule reads. Built by the caller from the ask's folded lifecycle
 * and its current-generation worker-session record.
 */
export interface AnswerFirstAsk {
  readonly channel: string;
  readonly messageTs: string;
  /** Which surface addressed the bot — only `channel` is public, and only a public ask is held to this. */
  readonly surface: "channel" | "dm";
  /** Whether the ask still holds an unsuperseded dispatch. See this module's header for why that is enough. */
  readonly dispatched: boolean;
  /** Whether that dispatch already posted its first answer — the thread has heard from it, so it is clear. */
  readonly firstAnswered: boolean;
  /** The visible session the ask's worker announced itself as, when one has been recorded. */
  readonly workerSessionId: string | undefined;
  /** When the ask was first captured — what the refusal turns into "open for 2h 38m". */
  readonly capturedIso: string;
}

/** What the answer-first rule says about one session right now. */
export type AnswerFirstVerdict =
  | { readonly kind: "clear" }
  | { readonly kind: "held"; readonly ask: AnswerFirstAsk; readonly openFor: string | undefined };

/**
 * Whether this session is holding an unanswered public ask, and which one.
 *
 * A session with no id at all is CLEAR, not held: `detectSupervisorSession` answers nothing outside a
 * visible host, and refusing every unidentifiable caller would turn a rule about dispatched workers into
 * a rule about everyone. The blind spot that leaves — a worker that has never announced itself, because
 * it ran neither `turn resume` nor `turn status` — is named in the door's own doc and is a tripwire
 * rather than a fence, exactly as `AGENTS.md` rule 3 says of the others.
 *
 * The OLDEST held ask wins when a session somehow holds two, because the one that has been public and
 * unanswered longest is the one a reader is already waiting on.
 *
 * @param asks every ask the caller could see, in any order
 * @param nowIso the instant the elapsed clause is measured against
 * @param sessionId the visible session asking, or `undefined` when this process could not name itself
 * @returns the held ask and how long it has been open, or that nothing holds this session
 */
export function answerFirstVerdict({
  asks,
  nowIso,
  sessionId,
}: {
  asks: readonly AnswerFirstAsk[];
  nowIso: string;
  sessionId: string | undefined;
}): AnswerFirstVerdict {
  if (sessionId === undefined || sessionId.length === 0) {
    return { kind: "clear" };
  }
  const held = asks
    .filter(
      (ask) => ask.dispatched && !ask.firstAnswered && ask.surface === "channel" && ask.workerSessionId === sessionId,
    )
    .toSorted((left, right) => Date.parse(left.capturedIso) - Date.parse(right.capturedIso));
  const oldest = held[0];
  if (oldest === undefined) {
    return { kind: "clear" };
  }
  return { ask: oldest, kind: "held", openFor: elapsedWords({ fromIso: oldest.capturedIso, toIso: nowIso }) };
}

/**
 * The one clause the refusal appends to its hatch row's standing reason — which ask, and for how long.
 *
 * Separate from the verdict so the refusal's own wording is assertable without a door, and so the
 * channel/ts pair is composed in exactly one place.
 *
 * @param ask the held ask
 * @param openFor how long it has been open, when both instants parsed
 * @returns the detail clause, with no trailing stop
 */
export function answerFirstDetail({ ask, openFor }: { ask: AnswerFirstAsk; openFor: string | undefined }): string {
  const age = openFor === undefined ? "" : `, open ${openFor}`;
  return `this session is the dispatched worker for ${ask.channel}/${ask.messageTs}${age} with no answer posted yet`;
}
