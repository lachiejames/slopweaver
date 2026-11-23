/**
 * The ASK half of a dispatch verdict — whether anybody was asked for a review, what the chase clause says, and the
 * verdict for a row GitHub holds on a code owner.
 *
 * Split out of `./landingDispatch.ts` beside `./landingDispatchGate.ts`: the ladder there decides which arm a row
 * reaches, and this module answers the one question a code-owner hold turns on — who has been asked, and where.
 *
 * Pure. No network, no clock, no filesystem.
 */

import type { DispatchDecision, DispatchInputs } from "./landingDispatch.js";

/**
 * Whether the Slack legs established that NOBODY has been asked, as distinct from not being able to tell.
 *
 * `cadence.ts` answers `unknown` for both — its own `why` says "nobody has been asked, so there is nothing to
 * bump" in one case and names an unreadable conversation in the other — and reading those apart by their
 * prose is the string-matching this repository forbids. `slack.asked` is the three-valued field that already
 * separates them: `no` is an absence the corpus window can CARRY, and `unknown` is one it cannot.
 *
 * MEASURED, and it is why this exists: five of the owner's 23 open pull requests
 * read `blocked-on` with `slack.asked: "no"`, and reading their
 * bump verdict alone reported every one as unread evidence when the real answer is that nobody has asked
 * anybody yet. Reproduce with `slopweaver github landing --repo acme/acme-admin --author <login> --json`
 * and compare each row's `slack.asked` against its `bump.kind`.
 *
 * @returns true only when the absence of an ask is one the window carries
 */
export function nobodyAsked({ inputs }: { inputs: DispatchInputs }): boolean {
  return inputs.state.slack.asked === "no" && inputs.state.bump.kind === "unknown";
}

/**
 * What a `draft-first-review-ask` session does, in the words its registered row carries as its whole brief.
 *
 * The owner's steer is why it stops at a record: an unasked Slack send to a person is a queue card with
 * the draft attached, never an act. `slack draft record` is that card — the parked-drafts register every
 * unasked message to a person goes to (`skills/slack/reference/draft-review.md`), which only the owner's yes sends.
 *
 * It opens on the owner's lead-with-the-discussion ruling, because the brief is the only text
 * the seat is handed: a review ask on a change nobody agreed to is a much worse violation, so
 * the seat links the discussion that came first, or names the small obvious bug, before it drafts any ask.
 *
 * The opener branch ends the row PAUSED on the owner's yes and then the people it asks, never settled: a row settled at
 * this head leaves the dispatchable selection (`../cli/commands/github/landingRegister.ts`'s `settledAtThisHead`),
 * so a settled opener would leave the ask owed after the team agrees and nothing left to draft it. Unpausing is a
 * deliberate act by whoever reads the agreement, because a pause carries no deadline or reminder by design.
 */
export const FIRST_ASK_BRIEF =
  "first link a team discussion outside the pull request where a person who owns the topic agreed the change " +
  "and no pushback or objection remains unresolved, either one from before the pull request or the thread of the opener this " +
  "row parked earlier; or name the bug's observed symptom, its one-line fix and why that fix touches nothing else, which is what " +
  "makes it small and obvious (the owner's lead-with-the-discussion row: `slopweaver knowledge recall review ask reviewer " +
  "--domain review`). Where neither holds, record a discussion opener to the channel and people that own the " +
  "topic instead of any ask, with `slack draft record --row <this row> --reviewer not-an-ask --asked-before " +
  "none` (and `--kind message` for a top-level post), never `--act review-ask`. Then pause this row ONCE as this " +
  "cycle's ending, never `handover finish` or settle, so `cmux spawn` can reseat it once unpaused: " +
  '`handover pause <this row> --on "the people the opener asks, once the owner sends it" --why ' +
  '<the draft id>`, one state covering both held and sent, then `handover release <this row> --why "paused on ' +
  "discussion opener <the draft id>\"` before you exit so the run is nobody's; whoever reads their agreement, the owner, " +
  "the supervisor or a seat on the thread, runs `handover unpause <this row> --why <the thread>`, and the " +
  'reseated seat runs `handover claim <this row> --why "resuming after agreement in <the thread>"`, links that ' +
  "thread and drafts the ask. A dropped opener leaves the row paused naming it, which is the owner's to settle. " +
  "Otherwise draft the FIRST review ask to a named person, never a team or a channel. Either way park it for the owner's yes with `slack draft record`, and never send " +
  "it yourself";

/**
 * The first-ask verdict, on the OWNER'S pull request only: a first review ask is the owner's word to a colleague about their own
 * work, so over anybody else's the row reads `outside-the-set` — {@link DispatchInputs.authoredByOwner}.
 *
 * @param why the brief the act carries
 * @returns `draft-first-review-ask` on the owner's own pull request, else `outside-the-set`
 */
export function firstAsk({ inputs, why }: { inputs: DispatchInputs; why: string }): DispatchDecision {
  if (!inputs.authoredByOwner) {
    return {
      kind: "outside-the-set",
      why: `nobody was asked to review it, and it is ${inputs.state.authorLogin}'s — the first ask is theirs to send`,
    };
  }
  return { kind: "act", verdict: "draft-first-review-ask", why };
}

/**
 * How a row describes the chase half, in the words the Slack evidence actually supports.
 *
 * @returns the clause, to follow "and"
 */
export function bumpWhy({ inputs }: { inputs: DispatchInputs }): string {
  const { bump } = inputs.state;
  if (bump.kind === "due") {
    return `a chase is DUE — the newest ask-like message found was ${bump.silentSinceIso} and nobody has answered`;
  }
  if (bump.kind === "too-soon") {
    return `a chase is not due yet (${bump.why})`;
  }
  if (bump.kind === "replied") {
    return bump.why;
  }
  if (nobodyAsked({ inputs })) {
    return "the Slack corpus reaches far enough to say nobody has been asked at all";
  }
  return inputs.state.slack.asked === "yes"
    ? `an ask-like message was found, and whether it was answered could not be established (${bump.why})`
    : `whether anybody has been asked could not be established (${bump.why})`;
}

/**
 * The verdict for a row GitHub is still holding a code-owner request on.
 *
 * @returns the verdict
 */
export function blockedVerdict({ inputs }: { inputs: DispatchInputs }): DispatchDecision {
  const owners = inputs.tests.find((test) => test.id === "codeowners-satisfied");
  const who = owners === undefined ? "GitHub still holds a code-owner request open" : owners.why;
  if (inputs.state.bump.kind === "due" && !inputs.state.slack.bounded) {
    return {
      kind: "unread",
      why: `${who}, and an ask went unanswered in the window this read could see — but that window cannot carry an absence`,
    };
  }
  if (inputs.state.bump.kind === "due") {
    return { kind: "act", verdict: "resolve-then-bump", why: `${who}, and ${bumpWhy({ inputs })}` };
  }
  // Shared with a channel and nobody named: green and yellow are a deliberate wait on the channel — an
  // acceptable state — and only red is the moment to name somebody, which the first-ask
  // arm below already is. An `unknown` clock is unread: the post was found, so "nobody asked" is not the
  // reading, and whether the channel answered past the Slack read is exactly what is not known.
  const share = inputs.state.channelShare;
  if (share !== undefined && share.tone !== "red") {
    const kind = share.tone === "unknown" ? "unread" : "waiting";
    return {
      kind,
      why: `${who}, and it was shared in ${share.channel} with nobody named — ${share.badge}: ${share.why}`,
    };
  }
  if (nobodyAsked({ inputs })) {
    return firstAsk({ inputs, why: `${who}, and ${bumpWhy({ inputs })} — ${FIRST_ASK_BRIEF}` });
  }
  if (inputs.state.bump.kind === "unknown") {
    return { kind: "unread", why: `${who}, but ${bumpWhy({ inputs })}` };
  }
  return { kind: "waiting", why: `${who}, and ${bumpWhy({ inputs })}` };
}
