/**
 * The creation door's ANSWER-FIRST gate — the effectful shell around `../../../live/turn/answerFirst.js`.
 *
 * A dispatched worker on a public ask answers the thread before it opens a pull request. The rule is the
 * owner's, and the measurement behind it is in that module's header; this file is only the
 * part that reads the state home and prints the refusal.
 *
 * ## What it reads, and why those two files
 *
 * The ask-lifecycle log says which asks still hold an unsuperseded dispatch and which surface each one
 * arrived on. The per-ask worker-session record
 * (`../../../live/turn/workerSessionStore.ts#currentGenerationWorkerSession`) says WHICH visible session
 * is holding it, and it is generation-bound by `leaseExpiresAt`, so a record left by an earlier dispatch
 * of the same ask cannot fire against this one.
 *
 * ## The blind spot, stated rather than discovered
 *
 * A worker announces itself from `turn resume` and `turn status`
 * (`announceThisSession`). A worker that ran neither has no record, so this gate cannot see it and lets
 * the push through. That is deliberate and it is the only honest option: the alternative identifier is
 * the worker's `cwd`, and `askSessionPlan` boots a worker into THE DISPATCHER'S OWN CHECKOUT rather than
 * a per-ask worktree (`../../../live/turn/tier.ts`'s `FreshVisibleSessionRef.cwd`), so matching on it
 * would read every other session in that directory — the loop itself included — as the worker. A
 * tripwire that misses is `AGENTS.md` rule 3's own shape: a block confirms you were wrong, its absence
 * means nothing.
 *
 * ## One ordering consequence worth knowing before you read a refusal
 *
 * This gate runs from `stackPushLocalGatesRefused`, which `../github/stackPushRun.ts` calls BEFORE the
 * locus reservation that detects an already-open pull request. So it refuses a RE-push of a branch whose
 * pull request is already open, not only a first creation. That is the right side to err on — the
 * measured incident is exactly a worker pushing more onto a pull request it had already opened while the
 * ask sat unanswered — and it costs nothing in the legitimate order, because the worker's first answer,
 * posted with `followThrough` declared, records `first-answered` on the ask and leaves this gate open while
 * KEEPING the dispatch: the worker survives its own post to open the pull request it promised.
 */
import { ESCAPE_HATCHES } from "../../../hatch/registry.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import type { EscapeHatch } from "../../../hatch/types.js";
import { askIdentityOf } from "../../../live/ask/identity.js";
import { foldAskLifecycle, parseAskLifecycleLog } from "../../../live/ask/lifecycle.js";
import { readAskLifecycleText } from "../../../live/ask/store.js";
import { type AnswerFirstAsk, answerFirstDetail, answerFirstVerdict } from "../../../live/turn/answerFirst.js";
import { currentGenerationWorkerSession } from "../../../live/turn/workerSessionStore.js";
import { detectSupervisorSession } from "../../../supervisor/session.js";

/** The register row this gate refuses through. Resolved by id so the gate never writes a refusal string. */
function answerFirstHatch(): EscapeHatch | undefined {
  return ESCAPE_HATCHES.find((row) => row.id === "answer-first");
}

/**
 * Every ask this state home knows about, in the shape the rule reads.
 *
 * The worker-session read is done only for an ask that still holds a dispatch, so a home with a long
 * lifecycle log costs one `readFileSync` per LIVE ask rather than per ask ever captured.
 *
 * @param home the resolved state home
 * @returns one entry per captured ask
 */
export function answerFirstAsksFrom({ home }: { home: string }): readonly AnswerFirstAsk[] {
  const parsed = parseAskLifecycleLog({ text: readAskLifecycleText({ home }) });
  const folded = foldAskLifecycle({ events: parsed.events });
  const asks: AnswerFirstAsk[] = [];
  for (const entry of folded.values()) {
    const dispatched = entry.activeDispatch !== undefined;
    const worker = dispatched
      ? currentGenerationWorkerSession({ askIdentity: askIdentityOf({ source: entry }), home })
      : undefined;
    asks.push({
      capturedIso: entry.capturedIso,
      channel: entry.channel,
      dispatched,
      firstAnswered: entry.firstAnswer !== undefined,
      messageTs: entry.messageTs,
      surface: entry.surface,
      ...(worker === undefined ? { workerSessionId: undefined } : { workerSessionId: worker.sessionId }),
    });
  }
  return asks;
}

/**
 * Whether the creation door must refuse this push because the session opening it owes a public thread an
 * answer first, printing the four-line refusal when it does.
 *
 * Never throws: an unreadable or absent lifecycle log folds to no asks, which is CLEAR. This gate exists
 * to catch a specific ordering mistake, and a home it cannot read is not evidence of one.
 *
 * @param env the environment, read only for the hatch
 * @param home the resolved state home holding the ask lifecycle log
 * @param nowIso the instant the refusal's elapsed clause is measured against
 * @param out where to print each line
 * @returns `true` when the caller must refuse, `false` when it may proceed
 */
export function answerFirstGateRefused({
  env,
  home,
  nowIso = new Date().toISOString(),
  out,
}: {
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  nowIso?: string;
  out: (args: { line: string }) => void;
}): boolean {
  const hatch = answerFirstHatch();
  if (hatch === undefined) {
    return false;
  }
  // Spelled out rather than derived through `hatchEnvVar`, because the `escape-hatch` gate joins a row to
  // its reader by finding the KEY in this file — a computed read is invisible to it, and a row whose reader
  // does not visibly read it is the defect that gate exists to catch.
  const open = env["SLOPWEAVER_ALLOW_ANSWER_FIRST"] === "1";
  if (open) {
    return false;
  }
  const detected = detectSupervisorSession({ env });
  const verdict = answerFirstVerdict({
    asks: answerFirstAsksFrom({ home }),
    nowIso,
    sessionId: detected.kind === "active" ? detected.session.id : undefined,
  });
  if (verdict.kind === "clear") {
    return false;
  }
  for (const line of hatchRefusalLines({
    detail: answerFirstDetail({ ask: verdict.ask, openFor: verdict.openFor }),
    hatch,
  })) {
    out({ line });
  }
  out({
    line: "  Post the answer first — one short reply saying what you have found and what you are about to change — then push.",
  });
  out({
    line:
      "  Declare `followThrough` { owes, what } on that answer's form: the post then keeps your dispatch and your " +
      "workspace, and your final answer later ends the turn.",
  });
  return true;
}
