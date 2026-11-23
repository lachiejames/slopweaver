/**
 * The card gate every dispatch crosses: an ask does not reach a worker until its ONE progress card has been
 * proved and its ts is on the brief. Read § "What it proves, and the one word it does not" before quoting
 * that as liveness.
 *
 * ## Why this exists at all
 *
 * MEASURED on a public security-channel ask. The capture-time
 * checklist post failed; `withCapturedChecklist` (`../../../live/listen/capture.ts`) swallows that by design,
 * so the ask went `captured` → `dispatched` with no `checklist-posted` event and a brief whose `started` was
 * absent. The worker then ran for 17 minutes with no card, because every main-flow card verb — `turn
 * status`, `turn watch`, `turn block`, `turn unblock` — refuses an ask with no capture-time checklist ref
 * (`./cardGates.ts`'s `startedRefOrRefusal`), and the only two `postWorking` call sites in the tree are
 * capture and answer time. A dispatched worker could not create its own card at all, and that must not be
 * structurally possible.
 *
 * ## What makes it structural rather than a patch
 *
 * The fix is NOT that this function tries harder. It is that {@link ensureLiveCard} returns the card's ref
 * and every tier handler takes that ref as a REQUIRED parameter, so a dispatch with no card does not
 * type-check — there is no ordering for a caller to get wrong and no branch for one to forget. A post that
 * genuinely cannot land refuses the whole dispatch: no worker is started, and the reason Slack gave is
 * printed rather than swallowed.
 *
 * It is also deliberately IDEMPOTENT in three directions, because a dispatch is retried in practice: a brief
 * that already carries `started` posts nothing, an ask whose `checklist-posted` event survived a brief that
 * lost it recovers the ref off the lifecycle fold rather than posting a second card, and a fresh post
 * records both the durable event and the brief so the next call takes one of the first two paths.
 *
 * ## And what FRAME it leaves standing
 *
 * Proving a card exists was only half the same incident. The card capture posts wears
 * `PENDING_ROUTE_STEPS` — `◦ Work out how to answer` — because at capture time routing has not run; the one
 * thing that corrects it, `../../../live/turn/turnBegin.ts`, runs only inside `turn run`, the INLINE path.
 * So nothing on the dispatch path ever advanced the card, and on that ask the card sat on that
 * placeholder for the whole two hours and thirty-eight minutes, in a public channel, while a worker that
 * never called `turn status` opened and enqueued a pull request. Routing HAS run by the time this gate is
 * crossed, so every branch here advances the card it proved onto
 * `../../../live/listen/capture.ts`'s `dispatchedCardFrame` — the same per-stage shape every later tick
 * writes. The frame the reader sees at the first tick is then the frame they see at every one after it.
 *
 * ## What it proves, and how a gone card is found
 *
 * A brief that already carries `started`, a ref recovered off the lifecycle fold, and a parent's card to ride
 * all assert that a card was posted ONCE, not that it is standing NOW. The advance every branch makes is the
 * check: it is a Slack edit, and Slack answers `message_not_found` for a message that no longer exists, so a
 * known card that is gone is replaced by a freshly posted one and the line this verb prints names the dead ts.
 * A shared card this ask may not write is READ instead of edited (`./liveCardWiring.ts`), the one path that costs
 * a Slack read. Only a not-found answer means gone — any other refused edit stays a
 * report, because the card may well still stand. This is what closes a card deleted under a shared ride in any
 * order (four orderings a log-only inference misreads), and
 * the older case on this gate's own branch: a brief re-cut for an ask whose
 * card was since deleted. The same rule `../../../live/turn/turnBegin.ts` applies to the inline path.
 *
 * ## A sub-ask rides its parent's card
 *
 * MEASURED in a project channel: the owner's one tag — add two people to the allow-list,
 * and answer one of their questions — put TWO progress cards in the thread, because the loop re-dispatched that
 * person's earlier question as its own turn and this gate, finding no card for it, posted one. A brief that names the ask it was
 * dispatched from (`ridesOn`, set by `turn brief --rides`) takes a FOURTH branch before posting: whenever that
 * parent has a card in this thread, this ask records the parent's card as its own and advances it —
 * one card per tag. Sharing a card is governed in `../../../live/ask/sharedCard.ts`: the newest holder writes,
 * and the last holder out removes it. A parent with no card here posts this ask's own card, and a ridden card
 * Slack reports gone is replaced; either way the line this verb prints says why, so a second card is never silent.
 *
 * Depth 1 — pure decision over injected seams, exactly so its behaviour is unit-tested against plain fakes.
 * The real ones are `./liveCardWiring.ts`.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { StartedChecklist } from "../../../live/ask/checklist.js";
import { type AskIdentity, askIdentityOf } from "../../../live/ask/identity.js";
import type { ParentCard } from "../../../live/ask/sharedCard.js";
import type { TurnRoutingBrief } from "../../../live/turn/brief.js";

/**
 * How the card this dispatch will hand its worker came to be — what {@link ensureLiveCard} actually did.
 *
 * @internal named so {@link LiveCard} and {@link liveCardLine} share one vocabulary; no other module takes it.
 */
export type LiveCardOrigin = "on-the-brief" | "recovered" | "rode-parent" | "posted";

/** The card a dispatch proved, and which of the three paths proved it. */
export interface LiveCard {
  readonly origin: LiveCardOrigin;
  readonly started: StartedChecklist;
  /**
   * Why the card could not be advanced onto the real per-stage shape, when it could not — `undefined` on the
   * ordinary path, where it was.
   *
   * A REPORT rather than a refusal, and that asymmetry against {@link LiveCardError} is deliberate. A card
   * that does not exist is the failure this whole gate was built for, so it stops the dispatch. A card that
   * exists but still wears the pre-routing frame is the symptom, not the cause: the thread has
   * a live card either way, and refusing the whole dispatch over a cosmetic frame would trade a worse
   * outcome (nobody investigates the ask at all) for a better-looking one.
   */
  readonly advanceFailed: string | undefined;
  /**
   * The ask whose card this one rode, on `rode-parent`; or, on `posted` for a brief that named one, why it
   * could not be ridden. `undefined` whenever the brief named no parent at all.
   */
  readonly parent: { readonly messageTs: string; readonly notRidden: string | undefined } | undefined;
  /** On `posted`, the ts of the card this ask already knew about that Slack reported gone, when that is why. */
  readonly replaced?: string;
}

/**
 * The ONE way proving a card can fail: Slack would not take the post.
 *
 * A union of one, declared rather than left on the default `readonly string[]`, because this directory is at
 * the `error-shape-threshold` gate's ceiling — and the shape it refuses is exactly a plain message authored
 * into an `err` call, which is what this used to be. `cause` carries Slack's own words separately from the
 * sentence a caller displays, so a later branch can read the reason without re-parsing the message.
 */
interface LiveCardPostFailedError {
  readonly code: "LIVE_CARD_POST_FAILED";
  readonly message: string;
  readonly cause: string;
}

/** Every way {@link ensureLiveCard} can fail. */
export type LiveCardError = LiveCardPostFailedError;

/** Builds {@link LiveCardError} values. Not exported: the union is this module's contract, the factory is its own. */
const LiveCardErrors = {
  postFailed: ({ cause, why }: { cause: string; why: string | undefined }): LiveCardPostFailedError => ({
    cause,
    code: "LIVE_CARD_POST_FAILED",
    message:
      "this ask has no live progress card and one could not be posted, so no worker was started — " +
      `${cause}. Fix that and re-run the dispatch; a public ask never reaches a worker without a card ` +
      "standing in its thread (owner ruling)." +
      (why === undefined ? "" : ` ${why}`),
  }),
} as const;

/** Everything {@link ensureLiveCard} needs from the world, injected so the decision runs against fakes. */
export interface LiveCardDeps {
  /** Whether the parent ask the brief names can be ridden right now — `../../../live/ask/sharedCard.ts`. */
  readonly parentCard: (args: { askIdentity: AskIdentity; parentMessageTs: string }) => ParentCard;
  /** The `checklist-posted` ref this ask's lifecycle log already carries, when it carries one. */
  readonly recordedStarted: (args: { askIdentity: AskIdentity }) => StartedChecklist | undefined;
  /** Mints the turn's id for a card this call posts; injected so a test can pin it. */
  readonly mintTurnId: () => string;
  /** Post the first card frame for this ask, answering the ts it landed on. Rejects when Slack refused it. */
  readonly postCard: (args: { brief: TurnRoutingBrief; turnId: string }) => Promise<{ readonly ts: string }>;
  /** Append the durable `checklist-posted` event, so a later brief can recover this ref on its own. */
  readonly recordChecklistPosted: (args: { askIdentity: AskIdentity; started: StartedChecklist }) => void;
  /** Write the ref onto the brief on disk, which is what every card verb downstream reads. */
  readonly persistStarted: (args: { started: StartedChecklist }) => void;
  /**
   * Edit the proved card onto the frame a DISPATCHED ask actually wears — the per-stage shape every later
   * tick writes. Resolves `"gone"` when Slack reports the message no longer exists, and rejects with the
   * reason on any other refused edit.
   */
  readonly advanceCard: (args: { brief: TurnRoutingBrief; started: StartedChecklist }) => Promise<"stands" | "gone">;
  /** Whether this ask is the shared card's writer now — `../../../live/ask/sharedCard.ts`'s `mayWriteCard`. */
  readonly mayWriteCard: (args: { askIdentity: AskIdentity; workingTs: string }) => boolean;
  /**
   * Ask Slack whether a card this ask may NOT write still stands, without editing it (an open holder in the log does not prove the card stands, because recovery re-opens holders of a
   * card that was already deleted). Same answers and rejection as {@link LiveCardDeps.advanceCard}.
   */
  readonly readCard: (args: { brief: TurnRoutingBrief; started: StartedChecklist }) => Promise<"stands" | "gone">;
}

/** What advancing a known card found: it stands (perhaps with a refused edit to report), or Slack says it is gone. */
type CardAdvance = { readonly kind: "gone" } | { readonly kind: "stands"; readonly refused: string | undefined };

/**
 * Advance the proved card — or, when another open ask writes it, only read it — turning a refused edit into a
 * reported reason rather than a failed dispatch. Either way Slack is asked, so a gone card is always found.
 */
async function advanceOrReport({
  askIdentity,
  brief,
  deps,
  started,
}: {
  askIdentity: AskIdentity;
  brief: TurnRoutingBrief;
  deps: LiveCardDeps;
  started: StartedChecklist;
}): Promise<CardAdvance> {
  // try/catch rather than `.catch()`, so a seam that throws SYNCHRONOUSLY is reported exactly like a
  // rejected edit. The shipped seam is an async function and cannot do that, but the asymmetry documented on
  // `advanceFailed` has to hold for every implementation of this dep, not only the one standing today.
  try {
    const writes = deps.mayWriteCard({ askIdentity, workingTs: started.workingTs });
    const advanced = writes ? await deps.advanceCard({ brief, started }) : await deps.readCard({ brief, started });
    return advanced === "gone" ? { kind: "gone" } : { kind: "stands", refused: undefined };
  } catch (cause: unknown) {
    return { kind: "stands", refused: cause instanceof Error ? cause.message : String(cause) };
  }
}

/**
 * Prove this ask has a live progress card, posting one if it has none, before any worker is handed its brief.
 *
 * @param brief the routing brief this dispatch is acting on
 * @param deps the lifecycle read, the poster and the two recorders
 * @returns the card's ref and how it was obtained, or the one reason no card could be stood up
 */
export async function ensureLiveCard({
  brief,
  deps,
}: {
  brief: TurnRoutingBrief;
  deps: LiveCardDeps;
}): Promise<Result<LiveCard, LiveCardError>> {
  const askIdentity = askIdentityOf({ source: brief });
  if (brief.started !== undefined) {
    return reuseKnownCard({ askIdentity, brief, deps, origin: "on-the-brief", started: brief.started });
  }
  const recorded = deps.recordedStarted({ askIdentity });
  if (recorded !== undefined) {
    return reuseKnownCard({ askIdentity, brief, deps, origin: "recovered", started: recorded });
  }
  const parent = parentOf({ askIdentity, brief, deps });
  if (parent?.kind === "ride") {
    // Recorded under THIS ask's identity, with the parent's whole ref — the same two writes a posted card
    // makes, in the same order, so a lost brief write recovers through the branch above rather than riding
    // twice, and every card verb this ask's worker runs finds the card exactly as it would its own.
    deps.recordChecklistPosted({ askIdentity, started: parent.started });
    deps.persistStarted({ started: parent.started });
    const advance = await advanceOrReport({ askIdentity, brief, deps, started: parent.started });
    if (advance.kind === "gone") {
      const notRidden = `its card (${parent.started.workingTs}) is gone from Slack`;
      return postOwnCard({ askIdentity, brief, deps, notRidden: { messageTs: brief.ridesOn!, notRidden } });
    }
    return ok({
      advanceFailed: advance.refused,
      origin: "rode-parent",
      parent: { messageTs: brief.ridesOn!, notRidden: undefined },
      started: parent.started,
    });
  }
  const notRidden = parent === undefined ? undefined : { messageTs: brief.ridesOn!, notRidden: parent.reason };
  return postOwnCard({ askIdentity, brief, deps, notRidden });
}

/**
 * A card this ask already knows about — on the brief, or recovered from its lifecycle log — reused rather than
 * posted again, UNLESS advancing it finds it gone from Slack: then a fresh card is posted and the dispatch line
 * names the dead ts. MEASURED: a shared card deleted by whichever holder
 * finished last, and the other then recovered, ran with a ref to a deleted message.
 */
async function reuseKnownCard({
  askIdentity,
  brief,
  deps,
  origin,
  started,
}: {
  askIdentity: AskIdentity;
  brief: TurnRoutingBrief;
  deps: LiveCardDeps;
  origin: "on-the-brief" | "recovered";
  started: StartedChecklist;
}): Promise<Result<LiveCard, LiveCardError>> {
  const advance = await advanceOrReport({ askIdentity, brief, deps, started });
  if (advance.kind === "gone") {
    // A replacement this gate already posted and recorded, whose brief write was lost to a crash: the log names a DIFFERENT card than the dead one on the brief, so that one is reused —
    // and checked against Slack in turn — rather than a third card posted beside it.
    const recorded = origin === "on-the-brief" ? deps.recordedStarted({ askIdentity }) : undefined;
    if (recorded !== undefined && recorded.workingTs !== started.workingTs) {
      return reuseKnownCard({ askIdentity, brief, deps, origin: "recovered", started: recorded });
    }
    return postOwnCard({ askIdentity, brief, deps, notRidden: undefined, replaced: started.workingTs });
  }
  if (origin === "recovered") {
    // The card IS standing — only the brief lost its ts, which is the shape a re-brief leaves behind. Writing
    // it back is what makes `turn status` work for the worker; posting a second card here would put two of
    // them in one thread, which is the exact thing the one-card ruling deleted a whole verb family over.
    deps.persistStarted({ started });
  }
  return ok({ advanceFailed: advance.refused, origin, parent: undefined, started });
}

/** The branch every other one falls through to: post this ask's own card, record it, and advance it. */
async function postOwnCard({
  askIdentity,
  brief,
  deps,
  notRidden,
  replaced,
}: {
  askIdentity: AskIdentity;
  brief: TurnRoutingBrief;
  deps: LiveCardDeps;
  notRidden: LiveCard["parent"];
  replaced?: string | undefined;
}): Promise<Result<LiveCard, LiveCardError>> {
  const turnId = deps.mintTurnId();
  const posted = await deps
    .postCard({ brief, turnId })
    .then((value) => ok(value))
    .catch((cause: unknown) => err(cause instanceof Error ? cause.message : String(cause)));
  if (posted.isErr()) {
    return err(LiveCardErrors.postFailed({ cause: posted.error, why: postedBecause({ notRidden, replaced }) }));
  }
  const started: StartedChecklist = { turnId, workingTs: posted.value.ts };
  deps.recordChecklistPosted({ askIdentity, started });
  deps.persistStarted({ started });
  // Advanced here too, for the second Slack write it costs, because the alternative is a branch: this path
  // could post the dispatched frame outright, and then the ONE place that knows what frame a dispatched card
  // wears would be two places, one of them reachable only on this module's rarest path. That is exactly the
  // shape this file's own header says the fix is not.
  const advance = await advanceOrReport({ askIdentity, brief, deps, started });
  if (advance.kind === "gone") {
    // Deleted between the post and its first edit Refused rather than posted
    // again: a card that vanishes that fast is being removed on purpose, and a retry loop is a second card.
    const cause = `the card it just posted (${started.workingTs}) was deleted before it could be advanced`;
    return err(LiveCardErrors.postFailed({ cause, why: postedBecause({ notRidden, replaced }) }));
  }
  return ok({
    advanceFailed: advance.refused,
    origin: "posted",
    parent: notRidden,
    started,
    ...(replaced === undefined ? {} : { replaced }),
  });
}

/** The sentence a refused post adds about why it was posting at all, when a card was known and not used. */
function postedBecause({
  notRidden,
  replaced,
}: {
  notRidden: LiveCard["parent"];
  replaced: string | undefined;
}): string | undefined {
  if (replaced !== undefined) {
    return `It did not reuse the card its brief names because that card (${replaced}) is gone from Slack.`;
  }
  if (notRidden?.notRidden === undefined) {
    return undefined;
  }
  return `It did not ride the card its brief names because ${notRidden.notRidden}.`;
}

/** The parent the brief names, judged — `undefined` when it names none. */
function parentOf({
  askIdentity,
  brief,
  deps,
}: {
  askIdentity: AskIdentity;
  brief: TurnRoutingBrief;
  deps: LiveCardDeps;
}): ParentCard | undefined {
  if (brief.ridesOn === undefined) {
    return undefined;
  }
  return deps.parentCard({ askIdentity, parentMessageTs: brief.ridesOn });
}

/**
 * The one line a dispatch prints about the card it just proved, so an operator reading the verb's output can
 * tell a recovered card from a freshly posted one without opening the log.
 *
 * A failed ADVANCE is named on the same line rather than logged separately, because the symptom it leaves —
 * a card standing on `◦ Work out how to answer` while a worker runs — is invisible from the verb's output
 * otherwise, and being invisible for two hours and thirty-eight minutes is what this whole change is about.
 *
 * @param card what {@link ensureLiveCard} returned
 * @returns the line to print
 */
export function liveCardLine({ card }: { card: LiveCard }): string {
  const what = {
    "on-the-brief": "live progress card already on the brief",
    posted: "live progress card posted for this dispatch",
    recovered: "live progress card recovered from the ask's lifecycle log and written back to the brief",
    "rode-parent": `live progress card of the ask this one was dispatched from (${card.parent?.messageTs}) ridden, not a second card`,
  }[card.origin];
  const because = liveCardBecause({ card });
  const head = `${what} — ts ${card.started.workingTs}, turn ${card.started.turnId}${because}`;
  if (card.advanceFailed === undefined) {
    return head;
  }
  return `${head}; still on the pre-routing frame, the advance was refused — ${card.advanceFailed}`;
}

/** The parenthetical naming why a card was posted when one was already known — empty when none was. */
function liveCardBecause({ card }: { card: LiveCard }): string {
  if (card.replaced !== undefined) {
    return ` (the card it knew, ${card.replaced}, is gone from Slack)`;
  }
  return card.parent?.notRidden === undefined ? "" : ` (not ridden because ${card.parent.notRidden})`;
}
