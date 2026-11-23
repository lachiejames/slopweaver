/**
 * The GitHub leg — the owner's own open pull requests, placed by whose move each one actually is.
 *
 * ## Whose move cannot be read off GitHub, and that is an owner ruling rather than a design choice
 *
 * GitHub's requested-reviewers is not the measure of whether a pull request has a reviewer. Reviewers are
 * only ever asked via Slack. So this leg never reads a review-request field to decide
 * whose move it is, and `slopweaver pane pr-status` — which ranks the same pull requests by an eight-rung
 * merge ladder and deliberately does not enrol on that field either — cannot answer the question this leg
 * exists to ask. {@link ../review/reviewState} can, because it searches Slack for the pull request and reads
 * who was tagged beside it. That is what splits the two sources, and it binds {@link ../silver/ruleZero}
 * directly: rule zero suppresses what is somebody else's move, and the Slack thread is the only place that
 * fact lives.
 *
 * The rule goes further: the concept of GitHub reviewer requests is ignored entirely. So a row does not even describe one as background.
 *
 * ## It consumes the RECOMMENDATION, and never re-derives one from the raw fields
 *
 * `reviewState.askRecommendation` is where the owner's rulings about pull requests are encoded, and they
 * move. This leg shipped its first build re-deriving whose move a pull request was from `ci`, `undrafted`
 * and `codeRabbit` directly — and by the time it reached its own base branch that derivation was already
 * wrong. CodeRabbit had become ADVISORY, so treating `changes-requested` as the owner's move to fix would have
 * withheld asks the owner had explicitly decided to make. `self-merges` had been added, an arm meaning nobody is
 * EVER asked, which a CI-and-draft derivation cannot express at all. Reading one field instead of five is
 * not a shortcut here; it is the only way this leg stays true as those rules keep moving.
 * {@link githubWhoseMove} maps every arm onto rule zero's three parties and does nothing else.
 *
 * ## An ask still has to name somebody a bump could REACH
 *
 * This is the one judgement the recommendation cannot make for us, and it is narrower than it was. The
 * class it was written against — the bot's own status digest in the owner's DM, linking a dozen pull
 * requests and reading as an ask against each — was fixed at source by `authorIsApp` and
 * `isOwnerOnlyConversation`, landed by the review-state work while this leg was being built. Re-measured
 * on real data over 38 open pull requests, the bot half of this rule now changes NOTHING,
 * and that is recorded here rather than quietly deleted because the next reader will otherwise re-derive
 * it.
 *
 * What survives is REACHABILITY. `already-asked` and `bump` both hand rule zero a `who` to sit the item
 * with and to name in a chase sentence, and an ask whose target cannot be read gives it an empty string —
 * one such ask is still live in this corpus, a direct message carrying no counterpart id. Rule zero would
 * report the row as *"sitting with  for 53h"*. So an ask that names nobody reachable is treated as no ask,
 * and the row says nobody has been asked yet, which is both true and actionable.
 *
 * ## A stacked pull request is nobody's ask, and the bottom row shows the stack
 *
 * The rule: nothing in a stack gets a review ask until the bottom lands. The list once asked the owner to
 * undraft the sixth pull request of a native stack and name a reviewer. `reviewState` now answers
 * `stacked` for any pull request whose base is not the repository's default branch, and this leg does two
 * things with it: the row is SUPPRESSED by its own rule-zero decision (waiting behind the bottom of its
 * stack is not the owner's move and not a colleague's), and the bottom pull request's background names the whole
 * chain, so the one row that does carry the ask shows where the others are queued. {@link prBackground}
 * and {@link prRuleZero} are where each half lives.
 *
 * ## `unknown` shows, and says so
 *
 * `reviewState` answers `unknown` rather than `no` where the Slack window cannot bound an absence, which is
 * the honest answer and not one rule zero has a party for. Such a row is placed as the OWNER's move and marked
 * {@link RankInput.unverified}, so it appears with its limit stated. Suppressing it would hide real work on
 * the strength of a stale cursor, and calling it "nobody asked yet" would state a fact nobody established.
 *
 * Pure — no I/O, no clock. `nowIso`, the roster names and the bot ids are all supplied by the caller.
 */

import { conflictPaths, conflictWhy, type PrReviewState } from "../review/reviewState.js";
import type { SlackMention } from "../review/slackEvidenceTypes.js";
import type { RuleZeroDecision, WhoseMove } from "../silver/ruleZero.js";
import { applyRuleZero } from "../silver/ruleZero.js";
import { traceBeforeRanking } from "../silver/traceBeforeRanking.js";
import { prEvidence, prReadings, prUnverified } from "./githubLegReadings.js";
import type { Item } from "./item.js";
import { asItem } from "./item.js";
import type { RankInput } from "./rank.js";

/** The words a row uses for an item that came from the owner's own work rather than from a person. */
export const SELF_ORIGIN = "your own pull request";

/**
 * Who one message named that a bump could actually reach.
 *
 * A tag naming somebody other than the poster is reachable however it was posted. A direct message reaches
 * its counterpart, when the record carries one — and the bot is excluded on both arms, which is now
 * belt-and-braces rather than the load-bearing rule it was: see the module header for the upstream fix and
 * the re-measurement that found it changes nothing here today.
 *
 * @param mention one message that linked the pull request
 * @param botIds Slopweaver's own declared Slack ids, from `profile.json`
 * @returns the ids this message named, empty when it named nobody a bump could reach
 */
export function askNames({ mention, botIds }: { mention: SlackMention; botIds: readonly string[] }): readonly string[] {
  const bots = new Set(botIds);
  const tagged = mention.tagged.filter((id) => id !== mention.authorId && !bots.has(id));
  if (tagged.length > 0) {
    return tagged;
  }
  if (!mention.isDirectMessage) {
    return [];
  }
  const counterpart = mention.counterpartId;
  if (counterpart.length === 0 || bots.has(counterpart) || bots.has(mention.authorId)) {
    return [];
  }
  return counterpart === mention.authorId ? [] : [counterpart];
}

/**
 * The asks on one pull request that named somebody reachable, newest first.
 *
 * @param state the pull request's seven answers
 * @param botIds Slopweaver's own declared Slack ids
 * @returns the asks a chase could actually act on
 */
export function namedAsks({
  state,
  botIds,
}: {
  state: PrReviewState;
  botIds: readonly string[];
}): readonly SlackMention[] {
  return state.slack.asks.filter((mention) => askNames({ botIds, mention }).length > 0);
}

/**
 * The person the newest reachable ask was aimed at, in words a row can show.
 *
 * Falls back to the raw Slack id when the roster does not know it. An id is poor prose and it is still
 * addressable, whereas dropping the row would hide the pull request entirely — the direction this whole
 * leg exists to avoid.
 *
 * @param state the pull request's seven answers
 * @param botIds Slopweaver's own declared Slack ids
 * @param namesById the roster, Slack id to display name
 * @returns the reviewer's name, or undefined when nobody reachable was named
 */
export function askedReviewer({
  state,
  botIds,
  namesById,
}: {
  state: PrReviewState;
  botIds: readonly string[];
  namesById: ReadonlyMap<string, string>;
}): string | undefined {
  const newest = namedAsks({ botIds, state })[0];
  if (newest === undefined) {
    return undefined;
  }
  const id = askNames({ botIds, mention: newest })[0];
  if (id === undefined) {
    return undefined;
  }
  return namesById.get(id) ?? id;
}

/**
 * Whose move one pull request is, from its own recommendation and its bump verdict.
 *
 * Four arms are the owner's outright, for three different reasons a reader should not have to infer.
 * `self-merges` means nobody is EVER asked — the owner lands those — so it is their move with nothing to
 * chase. `still-draft` and `blocked` are theirs because the pull request is not ready for
 * anybody else. `unknown` is theirs because the honest answer to "was anybody asked" was that this run could
 * not tell, and a row the owner can look at beats a row nobody sees.
 *
 * ## An ask that was ANSWERED is the owner's move again, and reading only the recommendation misses that
 *
 * `already-asked` says an ask went out, not that it is still outstanding. The bump verdict is what knows
 * the difference, and this function shipped its first build ignoring it — handing rule zero the ask's own
 * instant and letting it measure silence from there.
 *
 * MEASURED on the owner's real data, and it reached the card before it was caught: three security
 * pull requests carried `bump.kind` of `replied` — *"rlindqvist-acme reviewed after the ask, and one
 * landed review closes it"* — and every one of them produced **"Bump Jasper Nolan, they were asked to
 * review and have not answered"**, because the ask was 71 hours old. The same row scored
 * `stoppedOnOwner` at its cap for the OPPOSITE reason, a human having reviewed. One row asserting both that
 * somebody reviewed and that nobody answered is not a near miss; it is a row that would have had the owner nag a
 * colleague who had already done the work, which is the failure rule zero was written for.
 *
 * So a `replied` verdict returns the pull request to the OWNER. The silence ended, and what is left is theirs to act
 * on. Only `due`, `too-soon` and `unknown` still sit an item with somebody else — and then only when a bump
 * could reach a named person, see {@link askNames}.
 *
 * @param state the pull request's seven answers
 * @param botIds Slopweaver's own declared Slack ids
 * @param namesById the roster, Slack id to display name
 * @returns whose move it is, naming the reviewer where there is one
 */
export function githubWhoseMove({
  state,
  botIds,
  namesById,
}: {
  state: PrReviewState;
  botIds: readonly string[];
  namesById: ReadonlyMap<string, string>;
}): WhoseMove {
  // The owner opened it, nobody is asked, and nobody should be until the stack's bottom lands: the one arm where
  // "you have already acted" is exactly the fact, and the one rule zero suppresses on. See prRuleZero.
  if (state.recommendation === "stacked") {
    return { ownerAlreadyActed: true, party: "nobody" };
  }
  if (state.recommendation === "send-ask") {
    return { ownerAlreadyActed: false, party: "nobody" };
  }
  if (state.recommendation !== "already-asked" && state.recommendation !== "bump") {
    return { party: "owner" };
  }
  if (state.bump.kind === "replied") {
    return { party: "owner" };
  }
  const reviewer = askedReviewer({ botIds, namesById, state });
  if (reviewer === undefined) {
    return { ownerAlreadyActed: false, party: "nobody" };
  }
  return { party: "other", who: reviewer };
}

/**
 * The owed codeowner rules in the shortest form a row can act on — a count and the owners to chase.
 *
 * `codeowners.why` carries every rule's own sentence and is the right thing for `--json` and for a reader
 * who asks. On a row it is a paragraph: one live pull request owes five rules, and pasting all five put 380
 * characters into a cell whose whole job is to name one act.
 *
 * @param state the pull request's seven answers
 * @returns the count and the owners, or that only its own author owns them
 * @internal read through {@link answeredAskAct}.
 */
export function owedSummary({ state }: { state: PrReviewState }): string {
  const { owed, rules } = state.codeowners;
  const who = [...new Set(owed.flatMap((rule) => rule.clearableBy))].join(" ");
  const owner = who === "" ? "nobody but its own author" : who;
  return `${String(owed.length)} of ${String(rules.length)} rules, owed by ${owner}`;
}

/**
 * Whether a reviewer has answered an ask that went out, so the pull request is back with the owner.
 *
 * @param state the pull request's seven answers
 * @returns whether the ask was answered
 */
export function askWasAnswered({ state }: { state: PrReviewState }): boolean {
  const asked = state.recommendation === "already-asked" || state.recommendation === "bump";
  return asked && state.bump.kind === "replied";
}

/**
 * When the pull request last moved, by the clock rule zero should measure silence from.
 *
 * The newest reachable ask wins ONLY while the item is actually sitting with somebody, because that is the
 * one case where silence means a person has gone quiet. A chase measures from the ask rather than from the
 * last push, or a pull request asked about on Monday and rebased on Thursday reports three days of reviewer
 * silence as none.
 *
 * Once the ask has been ANSWERED the ask's instant is the wrong clock entirely — it would report the hours
 * a reviewer took to reply as hours the owner has been sitting on their answer. So an item back with the owner measures
 * from the pull request's own last movement.
 *
 * @param state the pull request's seven answers
 * @param whose whose move it is
 * @param botIds Slopweaver's own declared Slack ids
 * @returns the instant rule zero measures silence from
 */
export function prLastMovedIso({
  state,
  whose,
  botIds,
}: {
  state: PrReviewState;
  whose: WhoseMove;
  botIds: readonly string[];
}): string {
  if (whose.party !== "other") {
    return state.updatedAtIso;
  }
  return namedAsks({ botIds, state })[0]?.atIso ?? state.updatedAtIso;
}

/**
 * Who answered the ask, in words a row can show.
 *
 * Reads the GitHub logins of humans who reviewed after the newest ask, which is what the bump verdict
 * decided `replied` from. Falls back to naming nobody rather than inventing a person, because the sentence
 * has to survive a verdict reached some other way.
 *
 * @param state the pull request's seven answers
 * @returns the reviewer's login, or "a reviewer" when none was recorded
 */
export function reviewerWhoAnswered({ state }: { state: PrReviewState }): string {
  return state.reviewedSinceAsk[0]?.login ?? "a reviewer";
}

/**
 * The act an ANSWERED ask leaves the owner, now that the contract carries the verdict and not just the login.
 *
 * ## Why this is three sentences and not one
 *
 * The row said *act on the review* whatever the reviewer had said, because `PrReviewState` carried who
 * reviewed and never what they decided. Two of the three arms below were unsayable before: a reviewer who
 * APPROVED leaves the owner a merge, and a reviewer who requested CHANGES leaves them the changes.
 *
 * **And the merge sentence is gated on the codeowner rules, which is the whole point of the field.** MEASURED
 * on real data: three rows told the owner to merge pull requests whose codeowners had not approved, and GitHub
 * refused all three — one of them carrying a real named approver whose tick satisfied ONE rule while two
 * others were still owed. So an approval says merge only when {@link PrReviewState.codeowners} says every
 * invoked rule is satisfied; anything else names what is still owed, which is a sentence the owner can act on
 * rather than a button that will not press.
 *
 * @param state the pull request's seven answers
 * @param ref the `owner/name#number` the sentence is about
 * @returns the sentence
 * @internal read through {@link prDoneWhen}, which is the row's own entry point.
 */
export function answeredAskAct({ state, ref }: { state: PrReviewState; ref: string }): string {
  const reviewer = reviewerWhoAnswered({ state });
  const newest = state.reviewedSinceAsk[0];
  if (newest?.opinion === "changes-requested") {
    return `Act on the changes ${reviewer} requested on ${ref} — they answered your ask and it is back with you`;
  }
  if (newest?.opinion !== "approved") {
    return `Act on ${reviewer}'s review on ${ref} — they answered your ask and it is back with you`;
  }
  if (state.codeowners.verdict === "unsatisfied" || state.codeowners.verdict === "unknown") {
    return `Get the codeowner approvals ${ref} still owes before merging: ${owedSummary({ state })}`;
  }
  return `Merge ${ref} — ${reviewer} approved it and every codeowner rule it invokes is satisfied`;
}

/**
 * The act a CONFLICTING pull request leaves the owner: rebase it, and here is where it will fight.
 *
 * The paths sit after a colon so a react-now card carries "Rebase … onto staging" above the fold and the
 * file list in it — the same arrangement `owedSummary` uses for a codeowner list. When the paths could not
 * be measured the sentence says why instead, because "conflicts in no files" is not what an empty list
 * means.
 *
 * @param state the pull request's seven answers
 * @param ref the `owner/name#number` the sentence is about
 * @returns the sentence
 * @internal read through {@link prDoneWhen}, which is the row's own entry point.
 */
export function conflictingAct({ state, ref }: { state: PrReviewState; ref: string }): string {
  const paths = conflictPaths({ conflict: state.conflict });
  const why = conflictWhy({ conflict: state.conflict });
  const onto = `Rebase ${ref} onto ${state.baseRefName}`;
  if (paths.length === 0) {
    return `${onto} — GitHub reports it conflicting, and ${why}`;
  }
  const count = paths.length === 1 ? "1 file" : `${String(paths.length)} files`;
  return `${onto}, which it conflicts with in ${count}: ${paths.join(", ")}`;
}

/**
 * The act a STACKED pull request leaves the owner, which is always on a different pull request.
 *
 * Names the bottom of the stack when this read found it, because landing that is the only thing that moves
 * this one; otherwise names the branch it targets, which is all that is known.
 *
 * @param state the pull request's seven answers
 * @param ref the `owner/name#number` the sentence is about
 * @returns the sentence
 */
function stackedAct({ state, ref }: { state: PrReviewState; ref: string }): string {
  const { stack } = state;
  const bottom = stack.chain[0];
  if (stack.grounded && bottom !== undefined && bottom !== state.number) {
    const bottomRef = `${state.repoSlug}#${String(bottom)}`;
    return `Land ${bottomRef} first — ${ref} is PR ${String(stack.position)} of ${String(stack.size)} in its stack and gets no review ask until it targets ${stack.defaultBranch}`;
  }
  return `Land whatever ${stack.baseRefName} is stacked on first — ${ref} targets it rather than ${stack.defaultBranch} and gets no review ask until it does`;
}

/**
 * The one concrete sentence a row puts in its `doneWhen`.
 *
 * Every arm names an act, never a state to reach. "Unblock the pull request" is the failure `Item` exists to make
 * unrepresentable, and a chase says bump the person rather than do their half — rule zero's third part.
 *
 * @param state the pull request's seven answers
 * @param whose whose move it is
 * @returns the sentence
 */
export function prDoneWhen({ state, whose }: { state: PrReviewState; whose: WhoseMove }): string {
  const ref = `${state.repoSlug}#${String(state.number)}`;
  if (whose.party === "other") {
    return `Bump ${whose.who} in Slack about ${ref}, which they were asked to review and have not answered`;
  }
  if (askWasAnswered({ state })) {
    return answeredAskAct({ ref, state });
  }
  switch (state.recommendation) {
    case "conflicting":
      return conflictingAct({ ref, state });
    case "self-merges":
      return `Land ${ref} yourself — nobody is asked to review this one`;
    case "stacked":
      return stackedAct({ ref, state });
    case "still-draft":
      return `Undraft ${ref} and ask a named reviewer in Slack to look at it`;
    case "blocked":
      return `Unblock ${ref} so it can go out for review: ${state.ciDetail}`;
    case "unknown":
      return `Check in Slack whether anybody was asked to review ${ref} — this run could not tell`;
    // `already-asked` and `bump` reach here only when the ask named nobody a bump could be sent to, which
    // is the same situation as never having asked and gets the same sentence.
    case "already-asked":
    case "bump":
    case "send-ask":
      return `Ask a named reviewer in Slack to review ${ref} — nobody has been asked yet`;
    default: {
      const unreachable: never = state.recommendation;
      return unreachable;
    }
  }
}

/**
 * The row's own status, in the source's words.
 *
 * Carries a STALE CodeRabbit verdict here rather than in the ranking. It reads green while not being green,
 * so a reader deserves to know; it never changes what the owner does next, so it must not decide where the row
 * sits or what the row's explanation says. See {@link prReadings} for the live run that settled that.
 *
 * @param state the pull request's seven answers
 * @returns the status a row shows
 */
export function prState({ state }: { state: PrReviewState }): string {
  if (state.codeRabbit === "stale") {
    return `${state.recommendation}, and CodeRabbit's green is for an earlier push`;
  }
  return state.recommendation;
}

/**
 * What a pull request IS, before anything about whose move it is.
 *
 * It deliberately does NOT repeat the title. The renderer already prints `title` on its own line directly
 * above, and the first live run of this field showed the same words twice in a row — noise where background
 * was supposed to add something.
 *
 * The real description of a pull request is still the Problem cell of its own body, which `PrReviewState`
 * does not carry — that limit stands.
 *
 * @param state the pull request's seven answers
 * @returns the background
 */
export function prBackground({ state }: { state: PrReviewState }): string {
  const base = `A pull request you opened in ${state.repoSlug}. Its title is the line above.`;
  return [base, stackSummary({ state })].filter((sentence) => sentence !== "").join(" ");
}

/**
 * Where the pull request sits in its stack, in the one sentence a row shows — or nothing for a pull request
 * that is in no stack at all.
 *
 * Two shapes, because the two rows read differently. The BOTTOM of a stack carries the stack's only ask, so
 * its sentence lists what is queued behind it — that is the row the owner acts on, and it is where the position of
 * every other pull request in the chain is shown. A pull request ABOVE the bottom names its position and the
 * bottom it waits on, so the suppressed row still explains itself in `--json` and on a card's fold.
 *
 * A chain this read could not follow to the default branch says so rather than naming a bottom it did not
 * find.
 *
 * @param state the pull request's seven answers
 * @returns the sentence, or the empty string when the pull request is alone on the default branch
 */
function stackSummary({ state }: { state: PrReviewState }): string {
  const { stack } = state;
  const ref = (number: number): string => `${state.repoSlug}#${String(number)}`;
  if (stack.size === 1 && !stack.stacked) {
    return "";
  }
  const above = stack.chain.slice(stack.position).map(ref).join(", ");
  if (stack.position === 1 && stack.grounded) {
    return (
      `It is the bottom of a stack of ${String(stack.size)} and carries the stack's only review ask; ` +
      `${above} wait behind it until it lands.`
    );
  }
  const bottom = stack.chain[0];
  const target = `It targets ${stack.baseRefName} rather than ${stack.defaultBranch}`;
  if (!stack.grounded || bottom === undefined) {
    return `${target}, and this read could not follow its stack down to ${stack.defaultBranch}; it gets no review ask until it does.`;
  }
  return (
    `${target}, as PR ${String(stack.position)} of ${String(stack.size)} in a stack whose bottom is ${ref(bottom)}; ` +
    `it gets no review ask until ${ref(bottom)} lands.`
  );
}

/**
 * The `owner/repo#number` a pull request is known by everywhere on this list.
 *
 * @internal read through {@link prItem}; no caller outside this module names it.
 *
 * @param state the pull request's seven answers
 * @returns the reference, which is also the item's `nativeId`
 */
export function prRef({ state }: { state: PrReviewState }): string {
  return `${state.repoSlug}#${String(state.number)}`;
}

/**
 * The item one pull request produces, or undefined when it is incomplete.
 *
 * @param state the pull request's seven answers
 * @param whose whose move it is
 * @returns the item, or undefined when a mandatory field could not be filled
 */
export function prItem({ state, whose }: { state: PrReviewState; whose: WhoseMove }): Item | undefined {
  return asItem({
    candidate: {
      background: prBackground({ state }),
      doneWhen: prDoneWhen({ state, whose }),
      nativeId: prRef({ state }),
      provenance: "github leg — your own open pull request, placed by whose move it is",
      repo: state.repoSlug,
      source: "github",
      state: prState({ state }),
      title: state.title,
      whenIso: state.updatedAtIso,
      where: state.url,
      who: whose.party === "other" ? whose.who : SELF_ORIGIN,
      ...(state.headRefName.length === 0 ? {} : { branch: state.headRefName }),
    },
  });
}

/**
 * Rule zero for one pull request.
 *
 * @param state the pull request's seven answers
 * @param whose whose move it is
 * @param botIds Slopweaver's own declared Slack ids
 * @param nowIso the run's own instant
 * @returns the decision
 */
export function prRuleZero({
  state,
  whose,
  botIds,
  nowIso,
}: {
  state: PrReviewState;
  whose: WhoseMove;
  botIds: readonly string[];
  nowIso: string;
}): RuleZeroDecision {
  const decision = applyRuleZero({ lastMovedIso: prLastMovedIso({ botIds, state, whose }), move: whose, nowIso });
  if (state.recommendation !== "stacked") {
    return decision;
  }
  // Rule zero's own wording for this party is "you have already acted; nobody else has been asked yet",
  // which is true and says nothing about WHY nobody should be. The suppression is rule zero's; the reason
  // names the stack, so a reader of `--json` sees the ruling rather than a generic party.
  const bottom = state.stack.chain[0];
  const waitingOn =
    state.stack.grounded && bottom !== undefined && bottom !== state.number
      ? `${state.repoSlug}#${String(bottom)}, the bottom of its stack, landing`
      : `whatever ${state.stack.baseRefName} is stacked on landing`;
  return {
    ...decision,
    reason: `stacked — waiting on ${waitingOn}; never a review ask until it targets ${state.stack.defaultBranch}`,
  };
}

/**
 * Turn every open pull request into ranker input.
 *
 * `finishesInFlight` is true for all of them, which is the north star: wrapping up
 * in-flight work rather than chasing new shiny things. An open pull request is work already started by
 * definition; there is no arm here that is a new thing to begin.
 *
 * @param states every open pull request's seven answers
 * @param botIds Slopweaver's own declared Slack ids, from `profile.json`
 * @param namesById the roster, Slack id to display name
 * @param nowIso the run's own instant, supplied rather than read
 * @returns one rank input per pull request that produced a complete item
 */
export function githubLeg({
  states,
  botIds,
  namesById,
  nowIso,
}: {
  states: readonly PrReviewState[];
  botIds: readonly string[];
  namesById: ReadonlyMap<string, string>;
  nowIso: string;
}): readonly RankInput[] {
  const inputs: RankInput[] = [];
  for (const state of states) {
    const whose = githubWhoseMove({ botIds, namesById, state });
    const item = prItem({ state, whose });
    if (item === undefined) {
      continue;
    }
    inputs.push({
      finishesInFlight: true,
      item,
      readings: prReadings({ nowIso, state, whose }),
      ruleZero: prRuleZero({ botIds, nowIso, state, whose }),
      trace: traceBeforeRanking({ evidence: prEvidence({ state, whose }) }),
      unverified: prUnverified({ state }),
    });
  }
  return inputs;
}
