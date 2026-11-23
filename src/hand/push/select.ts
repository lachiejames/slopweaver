/**
 * THE PUSH LANE'S SELECTION — what is outstanding on the owner, and whether any of it is NEW.
 *
 * The lane is a push notification that reaches the owner off the fleet briefing: a live thing is blocked and needs
 * a sign-in, or pull requests are ready and need code owners picked.
 *
 * ## Arrival only: the rule that decides whether the owner keeps this lane switched on
 *
 * A push goes out when the outstanding set has GAINED a member since the last time this looked, and at no
 * other time. Not on persistence, not on departure, and — the one that matters — **never on age**. There is
 * no clock read anywhere in this file.
 *
 * That is the ruling that a wait on a person is a STATE and not a countdown, made mechanical. A lane that
 * re-pinged every fifteen minutes about a sign-in the owner already knows about is one they switch off, and
 * switching it off takes the sign-in case with it.
 *
 * ## Why the code-owner case arrives as a POSTED STEP rather than a second GitHub ranking
 *
 * "These PRs are ready, pick code owners" is already known to the session that got the pull request ready:
 * under rule 10 it cleared the CI, the threads and the conflicts itself and then met the one thing it cannot
 * do. Re-deriving that from GitHub here would be a second ranking to keep in step with
 * `../../pane/sections/prStatus.ts`'s, over the network, inside a notification lane — and the first time the
 * two disagreed the owner would get pinged about a pull request that was not actually ready. So the session posts a
 * hand step naming the pick, and this lane carries it. Both named cases are local reads.
 *
 * Pure: premises in, a decision out. The caller reads the register and the ask log.
 */
import type { WaitingTier } from "../../waiting/rank.js";
import { type HandStep, handStepTier } from "../step.js";

/** Which of the three things waiting on the owner a subject is. */
export type PushSubjectKind = "hand-step" | "sign-in" | "go-ahead";

/** One thing outstanding on the owner, reduced to what the lane needs. */
export interface PushSubject {
  readonly kind: PushSubjectKind;
  /** Stable across runs — this is what "already pushed" is judged on, so it can never be derived from a clock. */
  readonly id: string;
  /** The one line about it, already capped by whatever built it. */
  readonly headline: string;
  /** Where it ranks among everything waiting on the owner — the one ranking every surface shares. */
  readonly tier: WaitingTier;
}

/** The set the last push was judged against, read off the lane's own ledger. */
export interface PushedBefore {
  readonly ids: readonly string[];
}

/** What one pass of the lane decided. */
export interface PushDecision {
  /** Everything outstanding right now, in the order it is shown. */
  readonly outstanding: readonly PushSubject[];
  /** The members that were not outstanding last time — the only reason a notification is ever sent. */
  readonly arrived: readonly PushSubject[];
  /** Whether to send. True exactly when `arrived` is non-empty. */
  readonly send: boolean;
  /** Whether the ledger should record this pass — true when the set moved in either direction. */
  readonly record: boolean;
  /** One line saying what was decided, for `--json` and for the verb's own output. */
  readonly why: string;
}

/**
 * Every ask standing against the owner, folded down to what this lane reads.
 *
 * Deliberately not `../../live/turn/blockedOnHuman.ts`'s own row type: that carries a channel, a thread and a
 * standing, and a selection that took the whole thing would have to know what `ready-to-resume` means. The
 * edge maps; this decides.
 */
export interface WaitingAskPremise {
  /** `sign-in` or `risky-approval` — the two of the three `BlockedNeed`s that name something the owner does. */
  readonly kind: PushSubjectKind;
  /** The ask's own stable key, `<channel>/<messageTs>`. */
  readonly id: string;
  readonly headline: string;
}

/**
 * The ledger id a hand step pushes under — one spelling, shared with the snooze that departs it
 * (`./ledger.ts` § `departPushedSubject`).
 *
 * @param id the step's own id
 * @returns `hand:<id>`
 */
export function handSubjectId({ id }: { id: string }): string {
  return `hand:${id}`;
}

/**
 * One hand step as a push subject.
 *
 * @param step the open step
 * @returns the subject, keyed on the step's own id
 */
export function handStepSubject({ step }: { step: HandStep }): PushSubject {
  return {
    headline: step.what,
    id: handSubjectId({ id: step.id }),
    kind: "hand-step",
    tier: handStepTier({ step }),
  };
}

/**
 * One waiting ask as a push subject — team-blocked, because a Slack ask standing `waiting` is a turn somebody
 * started in a thread and is still waiting on the answer to.
 *
 * @param ask the ask, as the edge read it
 * @returns the subject, keyed on the ask's own key
 */
export function waitingAskSubject({ ask }: { ask: WaitingAskPremise }): PushSubject {
  return { headline: ask.headline, id: `ask:${ask.id}`, kind: ask.kind, tier: "team-blocked" };
}

/**
 * Decide whether this pass sends anything.
 *
 * In the order the caller supplied, which is the ONE ranking (`../../waiting/rank.ts`) — what blocks a colleague
 * first, a check-in last — so the banner's top arrival is the top blocker. Nothing here re-sorts: the priority
 * is decided once, upstream, by the module every surface shares.
 *
 * @param outstanding every subject waiting on the owner right now
 * @param before the ids the last recorded pass saw
 * @returns what is outstanding, what is new, and whether to send and to record
 */
export function decidePush({
  outstanding,
  before,
}: {
  outstanding: readonly PushSubject[];
  before: PushedBefore;
}): PushDecision {
  const known = new Set(before.ids);
  const arrived = outstanding.filter((subject) => !known.has(subject.id));
  const now = new Set(outstanding.map((subject) => subject.id));
  const departed = before.ids.filter((id) => !now.has(id));
  const send = arrived.length > 0;
  const record = arrived.length > 0 || departed.length > 0;
  return { arrived, outstanding, record, send, why: pushWhy({ arrived, departed, outstanding }) };
}

/**
 * The one line saying what the pass decided.
 *
 * It states counts and never a duration, for the reason at the top of this file: a sentence carrying "for
 * two days" is the first half of a deadline.
 *
 * @param outstanding everything waiting on the owner
 * @param arrived what is new
 * @param departed what the owner cleared since the last recorded pass
 * @returns the line, with no trailing punctuation
 */
function pushWhy({
  outstanding,
  arrived,
  departed,
}: {
  outstanding: readonly PushSubject[];
  arrived: readonly PushSubject[];
  departed: readonly string[];
}): string {
  if (arrived.length > 0) {
    return `${String(arrived.length)} new of ${String(outstanding.length)} outstanding — sending one notification`;
  }
  if (departed.length > 0) {
    return `nothing new; ${String(departed.length)} cleared — recording the set and sending nothing`;
  }
  if (outstanding.length > 0) {
    return `${String(outstanding.length)} outstanding, none new — the owner already knows, so nothing is sent`;
  }
  return "nothing is waiting on the owner";
}
