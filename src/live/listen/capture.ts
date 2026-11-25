/**
 * The shared capture-time UX: the exact wrapper chain a freshly captured mention passes through before a
 * visible turn ever sees it — ignore-check, the durable `captured` lifecycle event, the `:eyes:` reaction,
 * the capture-time checklist + native status, and the durable `checklist-posted` lifecycle event.
 *
 * Extracted from `src/cli/commands/listen/run.ts` (where it was private CLI wiring) so scheduled recovery's
 * survivors get the SAME UX a live socket tag gets, rather than a second hand-rolled copy that drifts from
 * it. The socket listener's own `capturingHandler` composes these same exported wrappers directly (it needs
 * `withQueueFile` threaded between the lifecycle append and the reaction, which this module's own
 * {@link capturedMentionHandler} convenience composer has no seam for); {@link capturedMentionHandler} is for
 * a caller — scheduled recovery — that never writes a queue file at all.
 */

import { err, type Result } from "../../lib/result.js";
import type { TodoStep } from "../../outbound/assistant/todoBlock.js";
import { currentlyIgnoredConversations } from "../ask/ignoredConversationStore.js";
import { ignoredEntranceVerdict } from "../ask/ignoredEntrance.js";
import { currentlyIgnoredAsks } from "../ask/ignoreStore.js";
import { appendAskLifecycleEvent, ensureCapturedAskLifecycle } from "../ask/store.js";
import { clampVisible, PENDING_ROUTE_STEPS, turnChecklist } from "../turn/answer.js";
import { reactionsToRetire } from "../turn/lifecycleReactions.js";
import { CARD_LINE_CAP, progressChecklistSteps } from "../turn/progressCard.js";
import type { ProgressTimelineEvent } from "../turn/progressLog.js";
import { questionForPlainField } from "../turn/quotedQuestion.js";
import type { PostedRef } from "../turn/run.js";
import { strippedAddressing, turnTaskLabel } from "../turn/taskLabel.js";
import type { Mention, MentionHandler } from "./mention.js";
import type { ListenLog } from "./socket.js";

/**
 * The seam for putting ONE lifecycle reaction on a tagged message, converging it there.
 *
 * `addReaction`/`removeReaction` are scoped down to exactly the channel/ts/name triple
 * `SlackWriteTransport` needs, rather than the transport itself, so a test can supply plain recording
 * closures with no `posted` wrapper to build.
 *
 * `lifecycle` is the FULL set (`../turn/lifecycleReactions.ts`), not a "previous" emoji, and that is the
 * whole point: every stale member is retired before `emoji` goes on, so a message can never wear two
 * lifecycle reactions that contradict each other. `removeReaction` is required rather than optional for the
 * same reason — an optional convergence is one a wiring site forgets, which is the defect this closes.
 */
interface LifecycleReactionSeam {
  readonly addReaction: (input: { channel: string; ts: string; name: string }) => Promise<boolean>;
  readonly removeReaction: (input: { channel: string; ts: string; name: string }) => Promise<boolean>;
  /** The bare reaction name (no colons) to leave standing — the shape `reactions.add` takes on the wire. */
  readonly emoji: string;
  /** Every lifecycle reaction the bot itself raises, so all but {@link LifecycleReactionSeam.emoji} come off. */
  readonly lifecycle: readonly string[];
  readonly log: ListenLog;
}

/** The seam for reacting to a freshly captured mention — before any turn work runs. */
export type CaptureReactionDeps = LifecycleReactionSeam;

/**
 * Retire every lifecycle reaction but the one about to be added, then add it.
 *
 * A failing REMOVAL is logged and never blocks the add: the reaction this seam exists to seed is a
 * latency-hiding courtesy, and a Slack fault while tidying an older one must not cost the tagger the signal
 * that their message was seen at all. (`../turn/poster.ts`'s terminal settle takes the opposite decision,
 * deliberately — there the convergence IS the product, and a half-converged message is reported as an
 * unsettled indicator rather than quietly finished.)
 *
 * @param deps the reaction seam this converges through
 * @param mention the tagged message to converge
 */
async function convergeLifecycleReaction({
  deps,
  mention,
}: {
  deps: LifecycleReactionSeam;
  mention: Mention;
}): Promise<void> {
  for (const stale of reactionsToRetire({ emojis: deps.lifecycle, standing: deps.emoji })) {
    try {
      await deps.removeReaction({ channel: mention.channel, name: stale, ts: mention.messageTs });
    } catch (error) {
      deps.log({
        line: `could not retire the stale :${stale}: reaction — continuing without it: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  const seeded = await deps.addReaction({ channel: mention.channel, name: deps.emoji, ts: mention.messageTs });
  if (!seeded) {
    deps.log({ line: `could not react to the tag with :${deps.emoji}: — continuing without it` });
  }
}

/** The ignore-registry check's own seam — reading fresh off disk, never cached across mentions. */
export interface IgnoreCheckDeps {
  readonly home: string;
  readonly log: ListenLog;
}

/**
 * Wrap a mention handler so a permanently-ignored ask (`slopweaver turn ignore`) is dropped BEFORE any other
 * capture effect — no lifecycle append, no queue append, no reaction, no checklist. The registry is read
 * fresh off disk on every call, never cached, because an ignore added between two mentions must take effect
 * on the very next one without restarting the listener.
 *
 * This is the outermost wrapper, deliberately: an ignored ask must never reach the lifecycle log at all —
 * see `../ask/ignore.ts`'s own header for why that is a genuinely different concept from a fresh
 * `no-response` judgement, which DOES get recorded.
 *
 * @param handler the mention handler this wraps
 * @param deps the state home to read the registry from, and where a drop is logged
 * @returns a handler that drops an ignored ask silently (but logged), else always calls `handler`
 */
export function withIgnoreCheck({ handler, deps }: { handler: MentionHandler; deps: IgnoreCheckDeps }): MentionHandler {
  return async (mention) => {
    const verdict = ignoredEntranceVerdict({
      askIdentity: mention,
      ignoredAsks: currentlyIgnoredAsks({ home: deps.home }),
      ignoredConversations: currentlyIgnoredConversations({ home: deps.home }),
    });
    if (verdict !== undefined) {
      deps.log({
        line:
          verdict.kind === "ask"
            ? `dropping a permanently-ignored ask — ${mention.channel}/${mention.messageTs}`
            : `dropping a tag in a permanently-ignored conversation — ${mention.channel}/${mention.messageTs}`,
      });
      return;
    }
    await handler(mention);
  };
}

/*
 * There is no burst-queue seam any more, and the absence is the design.
 *
 * A same-asker follow-up used to be parked here — durably queued, acknowledged with an
 * `:hourglass_flowing_sand:`, never judged — and it was surfaced only when the ask it sat behind reached a
 * releasing event. Measured: 34 rows stood behind targets that had already ended, so nothing was
 * ever going to release them, and one of them was a real question from the owner. The rule: answer the first tag, JUDGE each later one, answer it if it needs an answer, and otherwise put it on the
 * exclusion registry so it never comes up again.
 *
 * So every tag now takes the ordinary judged path. What the queue really protected — two workers composing
 * on one thread, measured — is carried instead by the brief: `../turn/brief.ts`'s
 * `otherActiveAsks` names the asker's own in-flight asks, so the judging session can fold the follow-up into
 * the ask already running, answer it separately, or decline it with `exclude`.
 */

/** The captured-lifecycle append's own seam. */
export interface CapturedLifecycleDeps {
  readonly home: string;
  readonly log: ListenLog;
}

/**
 * Wrap a mention handler so a `captured` ask-lifecycle event lands BEFORE any other capture effect —
 * lifecycle first, then the queue file, then the Slack UI effects (reaction, checklist). This is the ONE
 * deterministic fact this whole feature is built to never lose: that the listener saw this exact ask, at
 * this exact moment, regardless of what happens to any Slack write that follows.
 *
 * Goes through `ensureCapturedAskLifecycle` rather than a raw append, deliberately: `foldAskLifecycle`
 * resets an entry's `started`/terminal state whenever ANOTHER `captured` event lands for the same key (its
 * own doc says a `captured` event "always opens an entry"). A raw append here would let a redelivered or
 * re-emitted mention for an ask the fold already carries `started`/terminal state for silently wipe it —
 * exactly the guarantee Ask #1's checklist-freeze fix depends on. `ensureCapturedAskLifecycle` already reads
 * and folds the log first and is a no-op once an entry exists, so this closes the one reachable production
 * entrance without touching the fold's own semantics.
 *
 * A failed append is loud on stderr but never blocks capture — a full disk must not silently claim
 * durability, but it also must not prevent the still-live host from seeing the mention at all.
 *
 * @param handler the mention handler this wraps
 * @param deps the state home to append to, and where a failure is logged
 * @returns a handler that appends the `captured` event first, then always calls `handler`
 */
export function withCapturedLifecycle({
  handler,
  deps,
}: {
  handler: MentionHandler;
  deps: CapturedLifecycleDeps;
}): MentionHandler {
  return async (mention) => {
    try {
      ensureCapturedAskLifecycle({
        askIdentity: mention,
        home: deps.home,
        surface: mention.surface,
        text: mention.text,
        userId: mention.userId,
      });
    } catch (error) {
      deps.log({
        line: `could not append the captured ask-lifecycle event — continuing without it: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    await handler(mention);
  };
}

/**
 * Wrap a mention handler so the bot reacts to the CAPTURE, before the handler — and so before any turn
 * work — runs.
 *
 * This is the fix for the exact gap the owner named: the bot looks broken for minutes at a time between a
 * tag arriving and the working message appearing. `reactions.add` is near-instant, and firing it here, in
 * the listener, is the whole point — a reaction posted at turn start would inherit precisely the latency it
 * exists to hide.
 *
 * A failing reaction — thrown, or Slack refusing it — is reported through the log and the wrapped handler
 * still runs. The reaction is a courtesy; the mention being handled is the product, and it is also
 * IDEMPOTENT (Slack answers `already_reacted` for a repeat), so a redelivered frame re-reacting is harmless.
 *
 * It CONVERGES rather than merely adds — see {@link convergeLifecycleReaction}. A dequeued burst survivor
 * comes through this exact path wearing the queued hourglass, and before the convergence nothing took it
 * off, so the survivor advertised itself as queued and being worked at the same time (measured;
 * `../turn/lifecycleReactions.ts` carries the case).
 *
 * @param handler the mention handler this wraps
 * @param deps the reaction seam
 * @returns a handler that reacts first, then always calls `handler`, regardless of the reaction's outcome
 */
export function withCaptureReaction({
  handler,
  deps,
}: {
  handler: MentionHandler;
  deps: CaptureReactionDeps;
}): MentionHandler {
  return async (mention) => {
    try {
      await convergeLifecycleReaction({ deps, mention });
    } catch (error) {
      deps.log({
        line: `reacting to the tag threw — continuing without it: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    await handler(mention);
  };
}

/**
 * The seam for posting the capture-time checklist and the native status indicator, before any turn work
 * runs — the fix for the two-minute silence the owner measured between the `:eyes:` reaction and the
 * checklist appearing. See `../turn/poster.ts`'s header for why the orphan window this widens is accepted
 * rather than a defect.
 *
 * `postChecklist` is handed the exact `steps`/`task` this module already computed (with step 0 marked
 * done), rather than computing them itself, so THIS module — not the live adapter — owns the one fact that
 * must be true of the very first frame this bot ever shows: the question has been read.
 */
export interface CapturedChecklistDeps {
  /** Post the checklist and return its identity. May reject — the wrapper survives that. */
  readonly postChecklist: (input: {
    mention: Mention;
    turnId: string;
    steps: readonly TodoStep[];
    task: string;
  }) => Promise<PostedRef>;
  /** Set the native "thinking" indicator. May reject or resolve with a refusal — the wrapper survives either. */
  readonly setStatus: (input: { mention: Mention }) => Promise<Result<void, string>>;
  /** Mints the turn's id; injected so a test can pin it. */
  readonly mintTurnId: () => string;
  readonly log: ListenLog;
}

/**
 * The FIRST frame of a turn's one progress card — step 0 already complete, the question quoted under it.
 *
 * Exported because two paths now post that first frame and there must not be two shapes of it: this file's
 * capture wrapper, and `../../cli/commands/turn/ensureCard.ts`, which posts one at DISPATCH time for an ask
 * whose capture post never landed. That second caller is the structural half of the owner's
 * ruling — a public ask cannot reach a worker without a live card — and a copied frame builder there would
 * have re-created the second card shape that ruling deleted.
 *
 * Step 0 is already true at capture — the question has been read — so the very first frame this bot shows
 * says so, exactly like `beginTurn` does inside a turn proper. `PENDING_ROUTE_STEPS` rather than the
 * corpus-shaped default: routing has not run yet, so this module cannot know whether the turn will touch the
 * corpus at all, and posting corpus language for a verb-routed question was the defect
 * `PENDING_ROUTE_STEPS`'s own doc explains. `beginTurn` corrects this to the real route's steps the moment
 * it knows them.
 *
 * @param question the addressing message's own text, tags still normalised as the mention carries them
 * @returns the checklist steps and the card's task label
 */
export function firstCardFrame({ question }: { question: string }): {
  readonly steps: readonly TodoStep[];
  readonly task: string;
} {
  return {
    steps: turnChecklist({
      progress: {
        completed: 1,
        // Both helpers, for the reason `../turn/progressCard.ts` states at its own copy of this line: the
        // strip handles the normalised `@(id)` form, the rewrite the raw `<@U…>` one, and `details` is a
        // field Slack parses rather than prints.
        details: [
          clampVisible({
            cap: CARD_LINE_CAP,
            text: `"${questionForPlainField({ question: strippedAddressing({ question }) })}"`,
          }),
        ],
      },
      steps: PENDING_ROUTE_STEPS,
    }),
    task: turnTaskLabel({ question }),
  };
}

/**
 * The frame a card wears from the moment its ask is DISPATCHED — the same per-stage shape every later tick
 * writes, with no stage declared yet.
 *
 * `progressChecklistSteps` rather than {@link firstCardFrame}'s `PENDING_ROUTE_STEPS`, and that difference is
 * the whole point. MEASURED on `C0SYN000006`/`1789952379.135579`: routing had already chosen
 * `fresh-visible-session`, and `../turn/turnBegin.ts` — the one thing that corrects the
 * pre-routing placeholder — runs only inside `turn run`, the INLINE path. So the public thread's card sat on
 * `◦ Work out how to answer` for the whole dispatch, waiting for a `turn status` the worker never ran, while
 * that worker opened, pushed and enqueued a pull request. The owner, in the channel, asked what was happening
 * in the thread. Routing HAS run by the time a dispatch stands a card up, so the
 * placeholder is not just unhelpful there — it is out of date the instant it is posted.
 *
 * `nowDetail` is `undefined`, deliberately: the `now:` line is derived from the worker's own command log and
 * the worker has not made a tool call yet. An invented one would be the class of untruth
 * `../turn/progressCard.ts`'s own header spends three paragraphs refusing.
 *
 * `timeline` is the ask's progress log as it stands, never assumed empty: a RE-dispatched ask keeps its plan
 * and stages on disk, and a frame drawn from nothing would wipe them off the card until the next write.
 *
 * @param question the ask's own text, tags still normalised as the brief carries them
 * @param timeline the stages, plans and review rounds the ask's progress log already holds
 * @returns the checklist steps and the card's task label
 */
export function dispatchedCardFrame({
  question,
  timeline,
}: {
  question: string;
  timeline: readonly ProgressTimelineEvent[];
}): {
  readonly steps: readonly TodoStep[];
  readonly task: string;
} {
  return {
    steps: progressChecklistSteps({ finished: false, nowDetail: undefined, question, timeline }),
    task: turnTaskLabel({ question }),
  };
}

/** Post the checklist, turning a thrown or refused write into "no checklist exists" rather than a dead turn. */
async function postCapturedChecklist({
  deps,
  mention,
  steps,
  task,
  turnId,
}: {
  deps: CapturedChecklistDeps;
  mention: Mention;
  steps: readonly TodoStep[];
  task: string;
  turnId: string;
}): Promise<Mention["started"]> {
  try {
    const posted = await deps.postChecklist({ mention, steps, task, turnId });
    return { turnId, workingTs: posted.ts };
  } catch (error) {
    deps.log({
      line: `could not post the capture-time checklist — continuing without it: ${error instanceof Error ? error.message : String(error)}`,
    });
    return undefined;
  }
}

/** Set the native status indicator. A refusal or a throw is reported and never stops the turn. */
async function setCapturedStatus({ deps, mention }: { deps: CapturedChecklistDeps; mention: Mention }): Promise<void> {
  const outcome = await deps
    .setStatus({ mention })
    .catch((cause: unknown) => err(cause instanceof Error ? cause.message : String(cause)));
  if (outcome.isErr()) {
    deps.log({ line: `could not set the native status indicator — continuing without it: ${outcome.error}` });
  }
}

/**
 * Wrap a mention handler so the capture-time checklist is posted, and the native status indicator set,
 * before the wrapped handler ever runs — and so that both survive failing without blocking or killing the
 * turn. The wrapped handler receives the mention with `started` attached when the checklist post succeeded,
 * which is what lets the emitted mention JSON carry it through to `turn brief --turn-id --working-ts` — and,
 * since {@link withChecklistPostedLifecycle} durably records the same ref, what `turn brief` can now recover
 * on its own if that hand-off is ever missed.
 *
 * @param handler the mention handler this wraps — ultimately the emit/queue chain
 * @param deps the checklist and status seams
 * @returns a handler that posts the checklist and sets the status first, then always calls `handler`
 */
export function withCapturedChecklist({
  handler,
  deps,
}: {
  handler: MentionHandler;
  deps: CapturedChecklistDeps;
}): MentionHandler {
  return async (mention) => {
    const turnId = deps.mintTurnId();
    const { steps, task } = firstCardFrame({ question: mention.text });
    const started = await postCapturedChecklist({ deps, mention, steps, task, turnId });
    await setCapturedStatus({ deps, mention });
    await handler(started === undefined ? mention : { ...mention, started });
  };
}

/** The seam {@link withChecklistPostedLifecycle} needs: where to append, and where a failed append is reported. */
export interface ChecklistPostedLifecycleDeps {
  readonly home: string;
  readonly log: ListenLog;
}

/**
 * Wrap a mention handler so a `checklist-posted` ask-lifecycle event is appended — durably, keyed by
 * `(channel, messageTs)` — whenever the checklist actually posted, i.e. whenever `mention.started` is set.
 *
 * This is the fix for the exact gap a prompt-only convention left open: `skills/loop/SKILL.md` tells the
 * driving session to carry `started.turnId`/`started.workingTs` forward to `turn brief --turn-id
 * --working-ts` by hand, and nothing ENFORCED that a busy, multi-step turn actually did. Before this, the
 * ONLY record of the checklist's identity was that one stdout/queue-file JSON line — a single-consumption
 * hand-off, not a durable fact. Appending it here means `turn brief` can recover the same ref later
 * (`../ask/store.ts`'s `startedRefForAsk`) from the `channel`/`message-ts` it already requires, even when
 * the driving session never passed `--turn-id`/`--working-ts` at all.
 *
 * A failed append is reported and never blocks the turn — the same treatment `withCapturedLifecycle` gives
 * its own append, for the same reason: a full disk must not silently claim durability, but it also must not
 * stop the still-live host from seeing the mention.
 *
 * @param handler the mention handler this wraps
 * @param deps the state home to append to, and where a failure is logged
 * @returns a handler that appends the `checklist-posted` event (when `mention.started` is set) then always
 *   calls `handler`
 */
export function withChecklistPostedLifecycle({
  handler,
  deps,
}: {
  handler: MentionHandler;
  deps: ChecklistPostedLifecycleDeps;
}): MentionHandler {
  return async (mention) => {
    if (mention.started !== undefined) {
      try {
        appendAskLifecycleEvent({
          event: {
            channel: mention.channel,
            kind: "checklist-posted",
            messageTs: mention.messageTs,
            threadTs: mention.threadTs,
            tsIso: new Date().toISOString(),
            turnId: mention.started.turnId,
            workingTs: mention.started.workingTs,
          },
          home: deps.home,
        });
      } catch (error) {
        deps.log({
          line: `could not append the checklist-posted ask-lifecycle event — continuing without it: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    await handler(mention);
  };
}

/**
 * Compose the full shared capture-time UX around a terminal handler, in the one order that makes the
 * feature's own guarantees hold: ignore-check → burst-queue check → captured lifecycle → capture reaction →
 * capture-time checklist/status → checklist-posted lifecycle → `sink`.
 *
 * No queue-file seam here on purpose — the socket listener's own `--queue` durability sits between the
 * captured-lifecycle append and the reaction, a position this single composed function has no hook for, and
 * scheduled recovery (this composer's only other caller) never writes one at all. `lifecycle` backs THREE
 * separate steps (ignore-check, captured lifecycle, checklist-posted lifecycle), which is safe because all
 * three read the identical `{home, log}` shape.
 *
 * @param checklist the capture-time checklist/status seam
 * @param lifecycle the state home + log shared by the ignore-check and both lifecycle appends
 * @param reaction the capture-reaction seam
 * @param sink the terminal handler — what a survivor becomes once the shared UX has run
 * @returns the fully wrapped handler
 */
export function capturedMentionHandler({
  checklist,
  lifecycle,
  reaction,
  sink,
}: {
  checklist: CapturedChecklistDeps;
  lifecycle: CapturedLifecycleDeps & ChecklistPostedLifecycleDeps;
  reaction: CaptureReactionDeps;
  sink: MentionHandler;
}): MentionHandler {
  return withIgnoreCheck({
    deps: lifecycle,
    handler: withCapturedLifecycle({
      deps: lifecycle,
      handler: withCaptureReaction({
        deps: reaction,
        handler: withCapturedChecklist({
          deps: checklist,
          handler: withChecklistPostedLifecycle({ deps: lifecycle, handler: sink }),
        }),
      }),
    }),
  });
}
