/**
 * Which open pull requests are DEPENDENCY BUMPS, and which signal said so — the pure core of
 * `slopweaver github bump-drive`.
 *
 * The owner wants scheduled asks that get dependency bump pull requests over the line. The doc names three
 * populations and this module is exactly those three: a bump BOT's
 * pull request, a `renovate/`- or `dependabot/`-prefixed head, and a fleet-opened one whose TITLE is a bump.
 *
 * The bar the ladder below answers to: every dependency bump pull request is auto-merged, as well as pretty
 * much any slopweaver pull request. A bump in EITHER repository is pressed
 * the moment it is mergeable, and the one gap the owner wants named rather than routed around —
 * `acme/acme-admin` branch protection wanting a human review — is {@link awaitingHumanReview}.
 *
 * ## Three signals rather than one, and why each row carries the one that matched
 *
 * No single signal covers the population. MEASURED on the pre-move Slopweaver repository with
 * `slopweaver github bottleneck --repo <owner>/slopweaver`: ten of the 24 open pull requests were a Renovate
 * App's, so the author signal alone would be enough THERE — and it is exactly the signal
 * that fails on `acme-admin`, where the same bumps are opened under a different bot login, and on a bump a
 * session opened by hand after closing a bot's. A head-ref prefix survives an author rename; a title does
 * not need a branch convention. So all three run, and {@link BumpSignal} records which fired, because a row
 * selected by TITLE alone is the one a reader should look at twice.
 *
 * ## What this module deliberately does NOT decide
 *
 * It does not decide what to DO about a bump. That is `./bottleneck.ts`'s cause plus the six landing tests,
 * and folding an act in here would make the selection depend on the state — so a bump whose CI went red
 * would stop being a bump. Selection is about IDENTITY and stays stable.
 *
 * Pure. No network, no clock, no filesystem.
 */

import type { DependencyBotActors } from "../organisation/dependencyBots.js";
import { DEV_GATE_CHECK } from "./gatingChecks.js";
import type { LandingRow } from "./landing.js";
import { AWAITING_HUMAN_REVIEW } from "./landingTests.js";

/** Which test said this pull request is a dependency bump. */
export type BumpSignal = "bot-author" | "branch-prefix" | "title";

/*
 * Who counts as a bump bot is NOT declared here. It is `../organisation/dependencyBots.ts`'s
 * `DependencyBotActors`, built at each verb's effectful edge from the generic Renovate and Dependabot Apps plus
 * the organisation's own `dependencyBots`, and passed in as `bots`. A declared registry rather than a substring
 * test, so a human whose login happens to contain `renovate` is not swept up and a new bot is added deliberately.
 *
 * Two spellings are honoured, because a row may come from either API. The REST spelling, `<login>[bot]`, matches
 * outright. The GraphQL spelling drops the `[bot]` suffix, so it is honoured only when GitHub also typed the
 * author a `Bot`: the fleet read is GraphQL, so `renovate[bot]` alone never matched a landing row, and a Renovate
 * bump on a branch and title of its own was capped as somebody else's work. A human who
 * registers the login `renovate` — or the login of an organisation's own bot — is still a user, never a bump.
 *
 * The Renovate subset is the one whose description the fleet never writes over, on slopweaver and acme-admin
 * alike: its package table, age and confidence are what a reviewer of a bump reads.
 */

/**
 * Whether a registry names this row's author — a REST login outright, an app's bare login only when GitHub
 * typed the author a `Bot`.
 *
 * @param row the landing row whose author is asked about
 * @param logins the registry that carries a REST login, `[bot]` and all
 * @param appLogins the registry that carries an app's bare GraphQL login
 * @returns true when the author is one of them
 */
function authorIn({
  row,
  logins,
  appLogins,
}: {
  row: LandingRow;
  logins: readonly string[];
  appLogins: readonly string[];
}): boolean {
  return logins.includes(row.authorLogin) || (row.authorIsBot === true && appLogins.includes(row.authorLogin));
}

/** The head-ref prefixes both tools use, lower-cased. */
export const BUMP_BRANCH_PREFIXES: readonly string[] = ["renovate/", "dependabot/"] as const;

/**
 * Titles that are a dependency bump however the pull request was opened.
 *
 * Anchored at the start, because a bump's title always LEADS with the bump — a pull request merely mentioning
 * a version in passing is not one. The conventional-commit forms come first since that is what a fleet
 * session writes, and Renovate's and Dependabot's own wordings follow.
 */
const BUMP_TITLE_PATTERNS: readonly RegExp[] = [
  /^(?:chore|fix|build|deps)\(deps(?:-dev)?\)/iu,
  /^update dependency\s/iu,
  /^update\s\S+\smonorepo\b/iu,
  /^bump\s\S+\sfrom\s/iu,
] as const;

/** One selected pull request, with the signal that selected it. */
export interface BumpRow {
  readonly row: LandingRow;
  readonly signal: BumpSignal;
}

/**
 * Whether one pull request is a dependency bump, and by which signal.
 *
 * The signals are tried in falling order of how much they prove: an author who only ever opens bumps is a
 * stronger statement than a branch name, which is stronger than a string a human typed.
 *
 * @param row the landing row to classify
 * @param bots the dependency-bot identities this install recognises
 * @returns the signal that matched, or `undefined` when none did
 */
export function bumpSignalFor({ row, bots }: { row: LandingRow; bots: DependencyBotActors }): BumpSignal | undefined {
  if (authorIn({ appLogins: bots.bumpGraphqlAppLogins, logins: bots.bumpRestLogins, row })) {
    return "bot-author";
  }
  const head = row.headRefName.toLowerCase();
  if (BUMP_BRANCH_PREFIXES.some((prefix) => head.startsWith(prefix))) {
    return "branch-prefix";
  }
  if (isBumpTitle({ title: row.title })) {
    return "title";
  }
  return undefined;
}

/**
 * Whether a title, as typed, LEADS with a dependency bump.
 *
 * @param title the pull request's title
 * @returns true when one of the anchored bump wordings matches it
 */
export function isBumpTitle({ title }: { title: string }): boolean {
  return BUMP_TITLE_PATTERNS.some((pattern) => pattern.test(title));
}

/**
 * Every dependency bump in one fleet read, in the order the read returned them.
 *
 * @param rows every open pull request the landing read produced
 * @param bots the dependency-bot identities this install recognises
 * @returns one entry per bump, each naming the signal that selected it
 */
export function selectBumpRows({
  rows,
  bots,
}: {
  rows: readonly LandingRow[];
  bots: DependencyBotActors;
}): readonly BumpRow[] {
  const selected: BumpRow[] = [];
  for (const row of rows) {
    const signal = bumpSignalFor({ bots, row });
    if (signal !== undefined) {
      selected.push({ row, signal });
    }
  }
  return selected;
}

/**
 * The ONE act this verb takes on one bump, named the way the act is spelled.
 *
 * `undraft-and-enqueue` is its own word rather than folded into `enqueue` because it is TWO writes and the
 * first is irreversible in the sense that matters: undrafting a bump puts it in front of the codeowners
 * check, so a run that undrafted and then failed to enqueue has still changed what the repository shows.
 * `seat` is the escape for everything a verb cannot do in one pass — a rebase, a red check, a conflict — and
 * it is a BOARD ROW rather than a card, per rule 10: a fleet-found act on our own repository lands with a
 * ledger row and never asks the owner.
 *
 * `rewrite-body` is the one red check this verb does repair, and {@link bodyRewriteClears} states the whole
 * criterion for it. It sits above `seat` because a bump held ONLY by `dev-gate` is held by its own
 * description, which is mechanical — and the seat it would otherwise get is a whole session spent retyping a
 * form.
 *
 * `awaiting-human-review` is the arm for work no session on this machine can do, and it is deliberately NOT
 * a `seat`: see {@link awaitingHumanReview}.
 *
 * `review-withheld` is the same hold on a RENOVATE bump, whose review is the owner's and which they are
 * withholding: see {@link isRenovateAuthored}. Like `awaiting-human-review` it takes no act and files no row.
 *
 * `close-superseded` is never planned by this ladder: it is the owner's bump that a Renovate merge or the base
 * already carries, decided off a read of the owner's own pull requests by `./bumpSupersede.ts`, and named here so the report
 * prints one vocabulary.
 */
export type BumpAct =
  | "close-superseded"
  | "nothing"
  | "enqueue"
  | "undraft-and-enqueue"
  | "rewrite-body"
  | "review-withheld"
  | "awaiting-human-review"
  | "seat"
  | "held";

/** What this run does about one bump, and why. */
export interface BumpPlan {
  readonly row: LandingRow;
  readonly signal: BumpSignal;
  readonly act: BumpAct;
  /** Why this act. Always populated, `nothing` included. */
  readonly why: string;
}

/** The verdicts of one row's six landing tests, by id. */
function verdicts({ row }: { row: LandingRow }): ReadonlyMap<string, string> {
  return new Map(row.tests.map((test) => [test.id, test.verdict]));
}

/**
 * Every failing test that holds this bump back, in the row's own order.
 *
 * **No test is dropped for any signal.** Dropping `codeowners-satisfied` for a `bot-author` bump would rest
 * on a reading of `lachiejames/slopweaver` alone (Renovate cannot approve its own pull request and the only
 * code owner there is the operator, so the verdict would be permanent). MEASURED, that reading describes a
 * state that is not there —
 * `slopweaver github landing --repo lachiejames/slopweaver --include-drafts --json` answers
 * `codeowners-satisfied: pass` on every one of the 13 open rows, `GitHub holds no open code-owner request on
 * it`, so the drop changed nothing on the repository it was written for.
 *
 * The only place the drop would change anything is `acme/acme-admin`, where it hides a real, clearable, HUMAN
 * requirement behind a planned press the door verb then refuses.
 * `slopweaver github bump-drive --repo acme/acme-admin --dry-run` planned `enqueue` on nine of twenty
 * bumps, and `slopweaver github enqueue --pr <number> --repo acme/acme-admin --dry-run --acknowledge
 * codex-loop-incomplete --reason "…"` answered `REFUSED — review-not-approved`, naming an open code-owner
 * request out to `acme/acme-eng`. A pending owner there is a colleague who can and does approve, so
 * the answer is to WAIT and say so ({@link awaitingHumanReview}), never to plan a press nothing can take.
 *
 * @param row the landing row
 * @returns the ids of every test that did not pass
 */
function blockingTests({ row }: { row: LandingRow }): readonly string[] {
  return row.tests.filter((test) => test.verdict !== "pass").map((test) => test.id);
}

/**
 * Whether every blocking test EXCEPT `undrafted` passed — the condition that makes an undraft worth making.
 *
 * Asked apart from `row.ready`, which is false for a draft by construction: a draft that would pass all six
 * the moment it stopped being one is the population this verb exists for, and `ready` cannot express it.
 * MEASURED: four of the ten renovate drafts on one repository were in exactly that
 * state, and the reason nothing landed them was that no verb had a word for it.
 *
 * **A draft whose code owner is ALSO pending can never reach this**, and that is the property rather than a
 * coincidence: it carries two blocking tests, so the `every` below is false and the row seats. Undrafting is
 * the one write here that cannot be taken back in the sense that matters — it puts the pull request in front
 * of the codeowners check — so a bump waiting on a human review is never undrafted into that wait.
 *
 * @param row the landing row
 * @returns true when nothing but the draft flag stands in the way
 */
function readyBarDraft({ row }: { row: LandingRow }): boolean {
  return blockingTests({ row }).every((id) => id === "undrafted");
}

/**
 * Whether the ONE thing left holding this bump is a human review GitHub is naming somebody for.
 *
 * The rule: a dependency bump in either repository is pressed the moment
 * it is mergeable, and `acme/acme-admin`'s branch protection wanting a human review is the gap to NAME
 * rather than route around. So this arm exists to say the words and take no act at all.
 *
 * **It is not a `seat`, and three things say why.** A board row is the register of what is IN FLIGHT — work a
 * session picks up — and no session on this machine can approve a pull request. Nine acme-admin bumps in that
 * state would spend the whole five-row seat budget (`../cli/commands/github/bumpDriveCore.ts`) every pass and
 * crowd out the bumps that genuinely want a session; they would then be rows nothing can ever clear, which is
 * the class `skills/sweep` exists to delete; and work waiting on a person is a STATE rather than a task.
 *
 * **The criterion is the test's `fail` verdict WITH a named owner, and never `unknown`.** A truncated
 * requests read answers `unknown` (`./landingTests.ts`), which is unread evidence rather than a pending
 * human, and it stays a `seat`. Requiring a name is what makes this arm structurally unable to print
 * `AWAITING_HUMAN_REVIEW` with nobody named.
 *
 * Nothing is carried between passes: the ladder is pure and re-derives the act from a fresh read, so an
 * approval landing between two firings flips this row to `enqueue` on the next one with no state to expire.
 *
 * @param row the landing row
 * @param blocking the failing tests, already computed by the caller
 * @returns true when a named code owner is the whole of what is left
 */
function awaitingHumanReview({ row, blocking }: { row: LandingRow; blocking: readonly string[] }): boolean {
  if (blocking.length !== 1 || blocking[0] !== "codeowners-satisfied") {
    return false;
  }
  const test = row.tests.find((candidate) => candidate.id === "codeowners-satisfied");
  return test?.verdict === "fail" && row.blockedOn.length > 0;
}

/**
 * Whether Renovate opened this pull request, so its code-owner review is the owner's to give rather than a colleague's.
 *
 * Rulings: a Renovate-raised pull request is merged by the fleet itself, so a Renovate bump is never a review ask
 * drafted to a colleague; and the owner withholds their own review on Renovate pull requests, so they stay off
 * the owner's queue. So a Renovate bump whose only hold is a named code owner is the `review-withheld` arm — no act, no row, no Queue
 * card. Dependabot and a bump selected by branch or title alone keep `awaiting-human-review`: the rulings name
 * Renovate, and only the declared registry proves who opened it.
 *
 * @param row the landing row whose author is asked about
 * @param bots the dependency-bot identities this install recognises, whose Renovate subset decides
 * @returns true when a Renovate login authored it
 */
export function isRenovateAuthored({ row, bots }: { row: LandingRow; bots: DependencyBotActors }): boolean {
  return authorIn({ appLogins: bots.renovateGraphqlAppLogins, logins: bots.renovateRestLogins, row });
}

/**
 * The failing landing tests a body rewrite can clear, and the reason the set is exactly these three.
 *
 * `ci-green` is the one the rewrite acts on. The other two are TOLERATED beside it — each is a hold that
 * another path lifts, so waiting for it would leave the bump red for something a description fixes:
 *
 * - **`undrafted`**, because the population this verb exists for is renovate's DRAFTS (`renovate.json` sets
 *   `draftPR: true`), and a draft whose only other failure is a red `dev-gate` is the commonest member of it.
 *   The undraft happens on the next pass, once the gate it was holding has gone green.
 * - **`codeowners-satisfied`**, because a colleague's approval arrives on its own clock and the body has to be
 *   green before it can land when it does. Holding the rewrite for a pending review would mean the bump is
 *   STILL red on the pass that approval lands, which is the opposite of the rule that every mergeable bump is pressed at once.
 *
 * Every other failure — behind its base, unmergeable, a reviewer thread — wants a session whatever its body
 * says, and stays a `seat`.
 */
const BODY_FIXABLE_TESTS: readonly string[] = ["ci-green", "undrafted", "codeowners-satisfied"] as const;

/**
 * Whether a body rewrite is the whole fix for one bump.
 *
 * ## The finding, which is a fact about this repository rather than about renovate
 *
 * `dev-gate` runs `pr-format` over every pull-request body this repository owns, and it accepts only the C3
 * form. A bot template this repository owns can NEVER go green on the description it opened with; a Renovate
 * pull request is a stranger's, so only the security scans run on it (`../prformat/prBodyGate.ts`'s
 * `prOwnership`). MEASURED, before that split, three bumps each landed only after a session rewrote the body by
 * hand, which is a whole session spent on a mechanical edit — the bottleneck the owner wants removed. The
 * composer is `../outbound/github/bumpBodyForm.ts`, and its own test feeds the render straight into the real
 * `gatePrBody`.
 *
 * ## Why the criterion is this narrow
 *
 * All four conditions hold together or this is a `seat`:
 *
 * - **`bot-author` only, and never Renovate.** The claim is that nobody wrote this description by hand, and only
 *   the bump bots in `bots` — a declared registry — carry it. Rewriting a description a session wrote is
 *   discarding somebody's words, and a Renovate bot's description is the owner's to keep: `pr-format` checks only
 *   the security scans on it, so a Renovate bump red only on `dev-gate` is a seat.
 * - **Something is blocking**, and everything blocking is in {@link BODY_FIXABLE_TESTS} including `ci-green`.
 *   A bump that is behind its base, unmergeable or carrying a reviewer thread wants a session whatever its
 *   body says.
 * - **Every failing CHECK is `dev-gate`.** One red check that is not the body gate means the dependency
 *   itself broke something, and that is exactly the upgrade a rewrite must not paper over.
 * - **At least one check is failing.** An empty list with `ci-green` failing is a check that never RAN — a
 *   conflicting head, whose fix is a rebase, and a rewrite there would report progress on a pull request
 *   nothing had happened to.
 *
 * @param row the landing row, whose failing checks decide whether the body is the whole story
 * @param signal which test selected it
 * @param blocking the failing landing tests that are real work, already computed by the caller
 * @param bots the dependency-bot identities this install recognises
 * @returns true when rewriting the description is the entire remaining fix
 */
function bodyRewriteClears({
  row,
  signal,
  blocking,
  bots,
}: {
  row: LandingRow;
  signal: BumpSignal;
  blocking: readonly string[];
  bots: DependencyBotActors;
}): boolean {
  if (signal !== "bot-author" || isRenovateAuthored({ bots, row })) {
    return false;
  }
  if (!blocking.includes("ci-green") || !blocking.every((id) => BODY_FIXABLE_TESTS.includes(id))) {
    return false;
  }
  if (row.failingChecks.length === 0) {
    return false;
  }
  return row.failingChecks.every((check) => check.name === DEV_GATE_CHECK);
}

/**
 * The one act for one bump.
 *
 * The ladder is deliberately shorter than {@link BumpAct} suggests it could be: anything this pass cannot
 * finish in one invocation becomes `seat`, rather than a verb inventing a partial fix. A rebase, a red check
 * and a reviewer thread are all real work, and the doctrine for real work is a session, not a retry.
 *
 * @param bump the selected row and its signal
 * @param optOutLabels labels that hold a pull request back from any act, lower-cased
 * @param bots the dependency-bot identities this install recognises, whose Renovate subset keeps its description
 * @returns the act and the sentence behind it
 */
export function bumpPlanFor({
  bump,
  optOutLabels,
  bots,
}: {
  bump: BumpRow;
  optOutLabels: readonly string[];
  bots: DependencyBotActors;
}): BumpPlan {
  const { row, signal } = bump;
  const held = row.labels.filter((label) => optOutLabels.includes(label.toLowerCase()));
  if (held.length > 0) {
    return { act: "held", row, signal, why: `label ${held.join(", ")} opts it out of any act` };
  }
  if (row.queue.kind === "queued") {
    return {
      act: "nothing",
      row,
      signal,
      why: `GitHub already holds entry ${String(row.queue.position)} for it`,
    };
  }
  const test = verdicts({ row });
  const blocking = blockingTests({ row });
  if (test.get("undrafted") === "fail" && readyBarDraft({ row })) {
    return { act: "undraft-and-enqueue", row, signal, why: "every test but the draft flag passed" };
  }
  if (blocking.length === 0) {
    return { act: "enqueue", row, signal, why: "every landing test passed" };
  }
  if (bodyRewriteClears({ blocking, bots, row, signal })) {
    return {
      act: "rewrite-body",
      row,
      signal,
      why: `${DEV_GATE_CHECK} is the only failing check, and this bot's description can never satisfy it`,
    };
  }
  if (awaitingHumanReview({ blocking, row }) && isRenovateAuthored({ bots, row })) {
    return {
      act: "review-withheld",
      row,
      signal,
      why: `a Renovate bump GitHub holds for ${row.blockedOn.join(", ")} — the owner's review is withheld on Renovate pull requests, so no card and never a colleague ask`,
    };
  }
  if (awaitingHumanReview({ blocking, row })) {
    return {
      act: "awaiting-human-review",
      row,
      signal,
      why: `${AWAITING_HUMAN_REVIEW} from ${row.blockedOn.join(", ")} — it is pressed the pass that approval lands`,
    };
  }
  return { act: "seat", row, signal, why: `a session is needed for ${blocking.join(", ")}` };
}

/**
 * Plan every selected bump.
 *
 * @param bumps the selected rows
 * @param optOutLabels labels that hold a pull request back from any act, lower-cased
 * @param bots the dependency-bot identities this install recognises
 * @returns one plan per bump, in the order they were selected
 */
export function bumpPlans({
  bumps,
  optOutLabels,
  bots,
}: {
  bumps: readonly BumpRow[];
  optOutLabels: readonly string[];
  bots: DependencyBotActors;
}): readonly BumpPlan[] {
  return bumps.map((bump) => bumpPlanFor({ bots, bump, optOutLabels }));
}
