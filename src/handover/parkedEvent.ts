/**
 * The `parked` run-journal event — a seat that cannot proceed without the owner's steer, closed with its state kept.
 *
 * A seat on work the owner steered that reaches a point where it does not know how to proceed without another steer
 * is parked, closed in cmux, and replaced by a seat on something that does have the owner's steer, so every running
 * session is working on the highest priority thing. Closing a seat used
 * to lose where it stood; this event is what the closed seat leaves behind, so the answer can reseat it.
 *
 * Its own module, not a member written inline in `./ledger.ts`, so `./parked.ts` folds it with no import cycle,
 * not even a type-only one `no-cycle` ignores — the same split `./heldQuestion.ts` makes for `question-shaped`.
 */
import type { ParkWake } from "./parkWake.js";

/** How many lines of a parked seat's screen the event keeps — enough to see where it stopped, no scrollback. */
export const PARK_SCREEN_LINES = 40;

/**
 * The most characters `screenTail` may hold, so one wide terminal cannot make a journal line unbounded. Forty
 * lines at a generous 250 columns; the tail is cut from the FRONT, because the last lines are what it is for.
 */
export const PARK_SCREEN_TAIL_MAX_CHARS = 10_000;

/**
 * The last {@link PARK_SCREEN_LINES} non-trailing-blank lines of a screen, cut to
 * {@link PARK_SCREEN_TAIL_MAX_CHARS} from the front.
 *
 * @param screen the raw screen text a cmux read returned
 * @returns the bounded tail the event records
 */
export function parkScreenTail({ screen }: { screen: string }): string {
  const tail = screen.trimEnd().split("\n").slice(-PARK_SCREEN_LINES).join("\n");
  return tail.length > PARK_SCREEN_TAIL_MAX_CHARS ? tail.slice(-PARK_SCREEN_TAIL_MAX_CHARS) : tail;
}

/** What a checkpoint's `branch` reads when its run recorded none at `start` — a sentence, never a git ref. */
export const PARK_NO_BRANCH = "(no branch recorded at start)";

/**
 * The branch a parked run's checkpoint recorded at `start`, or `undefined` when it recorded none — so a reseat
 * rebuilding a pruned tree never hands {@link PARK_NO_BRANCH} to git.
 *
 * @param parked the checkpoint
 * @returns the recorded branch, or `undefined`
 */
export function parkedBranchOf({ parked }: { parked: ParkedEvent }): string | undefined {
  return parked.branch === PARK_NO_BRANCH ? undefined : parked.branch;
}

/**
 * The most characters one parked draft's text may hold. A Slack draft is capped well under this at its own
 * verb, so the cap only stops a hand-edited store from making one journal line unbounded.
 */
export const PARK_DRAFT_MAX_CHARS = 10_000;

/**
 * A message the parked seat had drafted and not sent, kept on the checkpoint so closing the seat loses none of
 * it (a closed seat's state is tracked so it can be resumed on demand). `ask-action` is the open question's own drafted message (`./askAction.ts`);
 * `slack-draft` is a HELD Slack draft recorded against this run's row (`slack draft record --row`).
 */
export type ParkedDraft =
  | { readonly kind: "ask-action"; readonly text: string }
  | { readonly kind: "slack-draft"; readonly id: string; readonly text: string };

/**
 * Decode a journalled `drafts` field. A member that is not a well-formed draft is dropped rather than coerced:
 * one with no text has nothing to keep, and the fold never re-validates history beyond reading it.
 *
 * @param raw the field's value as the journal line holds it
 * @returns the drafts, or `undefined` when the line carries no list (a checkpoint older than the field)
 */
export function decodeParkedDrafts({ raw }: { raw: unknown }): readonly ParkedDraft[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  return raw.flatMap((item: unknown): ParkedDraft[] => {
    if (typeof item !== "object" || item === null) {
      return [];
    }
    const draft: Readonly<Record<string, unknown>> = { ...item };
    const { id, kind, text } = draft;
    if (typeof text !== "string") {
      return [];
    }
    if (kind === "ask-action") {
      return [{ kind, text }];
    }
    return kind === "slack-draft" && typeof id === "string" ? [{ id, kind, text }] : [];
  });
}

/**
 * A seat at rest on the owner, closed with its state kept. Written by `handover park` (a seat waiting on the owner's
 * open question, or on a clock or CI it names as its `wake`) and by `session close-done` (any seat at rest with
 * no shell that will complete). Inert for
 * the run's PHASE; it RELEASES the writer it names, exactly as `released` does, so `handover reap` never
 * orphans a parked run and the reseated session claims it without `--force` (`./runOwner.ts`).
 */
export interface ParkedEvent {
  readonly kind: "parked";
  readonly atIso: string;
  /** The writer whose seat was closed — the session the release clears. */
  readonly sessionId: string;
  /** The cmux workspace that was closed, as it was named at the moment of closing. */
  readonly workspaceRef: string;
  /** The worktree the seat ran in, read off the live workspace — where a reseat reopens. */
  readonly worktree: string;
  /** The branch the run's current cycle opened on — what a reseat rebuilds the tree from once it is gone. */
  readonly branch: string;
  /** The open question the seat waits on, as the journal holds it; absent when it stopped between turns. */
  readonly question?: string;
  /** Every unsent message the seat had drafted; absent on a checkpoint written before the field existed. */
  readonly drafts?: readonly ParkedDraft[];
  /** What brings the seat back unasked — a clock or a pull request's CI (`./parkWake.ts`); absent on a park the owner answers. */
  readonly wake?: ParkWake;
  /** The last lines of the seat's screen before it closed, bounded by {@link parkScreenTail}. */
  readonly screenTail: string;
}

/**
 * One park's WAKE suspended while the owner's question stays open — `handover wake`, finding the run's own pull
 * request merged while the run waits on the owner, so a reseat could do nothing but close again. The park itself
 * STANDS (`./parked.ts`'s `activeParkedCheckpoint` is unmoved): the seat is still closed and parked on the owner.
 * Bound to the park by `parkIndex`, and it holds only while a question is open and no later line touches it
 * (`./parkWakeSuspension.ts`): an answer, a withdrawal, a correction, a fresh ask or a ruling lifts it with no
 * further line, so the wake is live again and reseats the seat that now has work.
 *
 * Not `park-cleared`, which ends the park: here nothing about the seat changed, only what can usefully wake it.
 * MEASURED: a merged park whose run waited on the owner's question was reseated, booted, and closed.
 */
export interface ParkWakeSuspendedEvent {
  readonly kind: "park-wake-suspended";
  readonly atIso: string;
  /** The standing park's position in the whole journal. */
  readonly parkIndex: number;
  /** The open question's text when the line was written, checked against the journal at the append. */
  readonly question: string;
  /** The open question's asked instant when the line was written, checked with its text. */
  readonly questionAskedIso: string;
  /**
   * How many lines the journal held when the wake judged the park. A lifting line anywhere past it voids the
   * suspension, so one landing between the append's read and its write cannot sit masked BEFORE it.
   */
  readonly judgedLength: number;
  readonly why: string;
}
