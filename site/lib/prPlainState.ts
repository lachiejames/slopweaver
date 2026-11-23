/**
 * A pull request row's state in words the owner would say out loud, and how long it has been open. Pure.
 *
 * A row never leads with an all-caps machine verdict such as `FINISH-OR-CARD-CLOSE`; it leads with a human-readable
 * state ("Draft · fleet lands it when CI is green", "In merge queue", "CI red · fleet to fix", "Draft · in progress"),
 * each with an age beside it.
 *
 * The state is read off the same three words `tagOf` (`./reviewHook.ts`) picks between, most specific first: a human
 * wait's next act, else the dispatch verdict, else the landing action — except that a dispatch the gate refused as
 * `unread` says nothing is known past that, never the action under it. Each closed set is mapped whole, so a word the
 * verb adds later prints as itself, still readable on hover, never as a guessed state. Each sentence claims only what
 * its word establishes: a verdict that keeps two next acts open says both. The machine word stays on the tag's hover.
 */
import type { LandingRow } from "../components/live/readLandingRow";

/** `src/review/humanWait.ts`'s next acts, said as a state. */
const WAIT_STATES: Readonly<Record<string, string>> = {
  // Only what every producer establishes: the next act is a review ask or a discussion opener
  // in the owning channel, so it says both. Whether anyone was asked before is not established — a re-pick of an
  // already-asked reviewer is `ask` too — and neither is who the opener goes to.
  ask: "Next: ask for a review, or open a discussion",
  // `bump` and `wait` both follow a review ask in Slack (`slack.asked === "yes"`); `wait` also covers a reviewer who
  // already replied, so neither says the review itself is still owed.
  bump: "Asked for a review · ask again",
  "name-the-reviewer": "Needs a reviewer named",
  // The classifier abstained on a Slack message, so nobody is known to have replied (`humanWait.ts`).
  "read-the-messages": "Slack messages need reading",
  // The Slack window is unread, stale or incomplete — any of the three.
  "sync-slack": "Slack history needs syncing",
  wait: "Asked for a review · waiting",
  "wait-on-channel": "Shared in a channel · waiting",
};

/** `src/review/landingDispatch.ts`'s dispatch verdicts, said as a state. `rebase-and-fix` is told apart below. */
const VERDICT_STATES: Readonly<Record<string, string>> = {
  // Any bot's open threads, not only CodeRabbit's (`landingDispatch.ts`'s own regression test). Issued off
  // the open count alone, so a thread may want only a reply: it says answer, never fix.
  "coderabbit-loop": "Bot review comments · fleet to answer",
  // The first message may be a review ask or a discussion opener; the verdict keeps both.
  "draft-first-review-ask": "Nobody asked yet · fleet to draft the first message",
  // Finish it or propose closing it: the worker decides off the evidence, so the state keeps the fork.
  "finish-or-card-close": "Draft · fleet to finish it or propose closing it",
  "merge-now": "Ready · fleet to land it",
  "needs-owner-judgment": "Needs your call",
  // A code owner or an overdue reviewer still holds it. Owed answers are not established: a blocked-on row with an
  // overdue chase reaches this verdict with no thread open (`landingDispatchAsk.ts`), so it says only the hold.
  "resolve-then-bump": "A reviewer still to clear it",
  "resolve-then-merge": "Review comments · fleet to answer",
};

/** `src/review/landing.ts`'s landing actions, said as a state. */
const ACTION_STATES: Readonly<Record<string, string>> = {
  "answer-threads": "Review comments to answer",
  // `codeowners-satisfied` failed: a pending code owner, or a review decision with no code-owner request at all
  // (`landingTests.ts`), so it names the review, never who holds it. AGENTS.md rule 1's own words.
  "blocked-on": "Waiting on a human review",
  conflicting: "Conflicts with its base",
  // Draft status only: a draft parked on the owner or armed to wake is waiting, so it never claims work in progress.
  draft: "Draft",
  // The queue test failed, before threads or code owners were looked at, so this claims nothing about readiness. It
  // reads the base branch's queue only, so another branch of the same repository may still have one.
  "no-queue": "No merge queue on its base branch",
  "opted-out": "Opted out of landing",
  // Pressed and absent from the queue; why it is absent is not established (`landing.ts`).
  "pressed-not-queued": "Pressed · not in the merge queue",
  press: "Ready to land",
  queued: "In merge queue",
  // Red CI, or a required check that never ran (`landingTests.ts`'s ci-green). An action names what is needed, never
  // that a session already took it, so no fleet clause here.
  "spawn-ci": "CI needs work",
  // CodeRabbit asked for changes, or its review is stuck.
  "spawn-coderabbit": "CodeRabbit review needs attention",
  // Its base is not the default branch; that another open pull request heads that base is not established
  // (`src/review/stack.ts` marks a one-item, ungrounded stack too).
  stacked: "Based on a branch other than the default",
  unknown: "Not known yet",
};

/**
 * The sentence a closed set says for a word, or the word itself when the set does not own it. An own-key read, so a
 * word that names an inherited member (`toString`, `constructor`) prints as itself, never as a function.
 *
 * @returns the sentence, or the word
 */
function sayOf({ states, word }: { states: Readonly<Record<string, string>>; word: string }): string {
  // `Object.entries` lists own keys only, so an inherited member is never found here.
  const said = Object.entries(states).find(([key]) => key === word);
  if (said === undefined) {
    return word;
  }
  return said[1];
}

/**
 * One row's state, in words.
 *
 * @param wait the next act of the human wait the row draws (`drawnWaitOf`), when it is waiting on one, and who the owner
 *   picked when a pick superseded the verb's wait
 * @returns the state, or the machine word itself when it is one this map has never seen
 */
export function plainStateOf({
  row,
  wait,
}: {
  row: Pick<LandingRow, "action" | "dispatchKind" | "verdict">;
  wait: { readonly next: string; readonly pickedReviewer?: string | undefined } | undefined;
}): string {
  if (wait !== undefined) {
    if (wait.next === "ask" && wait.pickedReviewer !== undefined) {
      // A pick the owner approved: the act is asking that person, never a discussion opener. Unnamed, as the
      // row's own fold already names who.
      return "Next: ask the reviewer you picked";
    }
    return sayOf({ states: WAIT_STATES, word: wait.next });
  }
  if (row.dispatchKind === "unread") {
    // The dispatch gate refused a claim because a fact it rests on was not read (capped reviews hiding a standing
    // changes-requested, say), while the landing action can still read `press`. Nothing past that is known.
    return "Not known yet · a fact it rests on was not read";
  }
  if (row.verdict === "rebase-and-fix") {
    // The verdict covers both a failing rollup and a conflict; the landing action says which one this row has.
    return row.action === "conflicting" ? "Conflicts · fleet to fix" : "CI needs work · fleet to fix";
  }
  if (row.verdict === "coderabbit-loop" && row.action === "spawn-coderabbit") {
    // A CodeRabbit verdict, possibly stuck with every comment resolved, not open bot threads.
    return "CodeRabbit review · fleet to handle it";
  }
  if (row.verdict !== undefined) {
    return sayOf({ states: VERDICT_STATES, word: row.verdict });
  }
  return sayOf({ states: ACTION_STATES, word: row.action });
}

/**
 * {@link openAgeOf} to the wall clock, the way `./ageOf.ts`'s `ageOf` ages a reading on render.
 *
 * @param createdAtIso when it was opened
 * @returns the short age
 */
export function openAge({ createdAtIso }: { createdAtIso: string }): string {
  return openAgeOf({ createdAtIso, nowMs: Date.now() });
}

/** A UTC instant as GitHub writes `createdAt`, with optional milliseconds. */
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;

/**
 * The instant a UTC timestamp names, or `undefined` when it names none. `Date.parse` rolls a day that does not exist
 * (the thirtieth of February) into the next month rather than refusing it, so the parsed instant must print
 * back to the same seconds it was read from.
 */
function utcInstantOf({ iso }: { iso: string }): number | undefined {
  if (!UTC_INSTANT.test(iso)) {
    return undefined;
  }
  const at = Date.parse(iso);
  if (Number.isNaN(at) || new Date(at).toISOString().slice(0, 19) !== iso.slice(0, 19)) {
    return undefined;
  }
  return at;
}

/**
 * How long a pull request has been open, as the mockup's short chip: minutes, hours or days, rounded down.
 *
 * @param createdAtIso when it was opened, a UTC instant
 * @param nowMs the clock the age is measured to
 * @returns the age, `now` inside the first minute, or a stated refusal to read an instant that is not a real UTC one
 */
export function openAgeOf({ createdAtIso, nowMs }: { createdAtIso: string; nowMs: number }): string {
  const at = utcInstantOf({ iso: createdAtIso });
  if (at === undefined) {
    return "age unreadable";
  }
  const minutes = Math.floor(Math.max(0, nowMs - at) / 60_000);
  if (minutes < 1) {
    return "now";
  }
  if (minutes < 60) {
    return `${String(minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)}h`;
  }
  return `${String(Math.floor(hours / 24))}d`;
}
