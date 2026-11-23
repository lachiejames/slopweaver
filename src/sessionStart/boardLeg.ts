/**
 * The board leg — the `WAITING ON OWNER` slice of the handover board, turned into ranked items.
 *
 * ## Why this leg is first, and why it needs no new machinery
 *
 * Every other detector infers that something might be the owner's move. This one does not infer: a session did the
 * work, wrote down the specific question it could not settle, and stopped. The register already exists
 * (`slopweaver handover list`), so this leg READS it and never authors a second one — a queue assembled
 * from anything but the existing doors becomes a fourth board, and a stale board is worse than no board
 * because the owner cannot tell which to trust.
 *
 * ## The one judgement call: what grade a journal fact carries
 *
 * {@link ../silver/traceBeforeRanking} can only let an item rank on evidence a provider owns, and this
 * system authored every byte of a run journal. Graded naively, that would make every board item
 * `re-read-live` and this leg would emit nothing.
 *
 * The line that actually matters is not who wrote the file, it is **journal structure versus doc prose**:
 *
 * - A `question` event with no `answered` after it is a STRUCTURAL fact of an append-only log, derived the
 *   same way `handover list` derives the phase it prints. For a board item the handover store IS the
 *   provider — there is no other system of record — exactly as GitHub is the provider for a pull request's
 *   merge state. That grades `provider-fact`.
 * - A doc's `summary` saying the work is finished is PROSE a machine wrote about the world. That grades
 *   `machine-account`, and on its own it can never close an item.
 *
 * That split is not a nicety; it is the whole reason this leg is safe. Both halves of it were bought:
 * item 3 of the first card ("restart your listener") was taken from a board doc's summary prose instead of
 * a live read and was struck, and `slack-huddle-transcript-source` sat on the board reading as work while
 * its question had already been answered by events elsewhere. So a doc whose own prose claims completion
 * does not rank here — it goes back for a live read, which is the behaviour those two incidents paid for.
 *
 * ## A DEAD holder's question is a question nobody is waiting on
 *
 * `stoppedOnOwner` is the highest-weighted signal in the ranking, and this leg used to set it at its cap for
 * every row on the strength of the journal alone. MEASURED: all three of the finished rows the
 * owner found on their list came from runs whose holding session no longer exists. A dead session cannot
 * write an `answered` back, so its question stays frozen in `WAITING ON OWNER` while the work it asks about
 * moves on — which is exactly how a question about a pull request that had already merged kept scoring as
 * somebody stopped on the owner.
 *
 * So the row is not silently dropped and it is not left claiming a stand-off that is not happening. It says
 * what it now IS: an orchestration run whose session is gone, for the owner to resume or abandon, with
 * `stoppedOnOwner` at zero so it ranks below every run that genuinely does have somebody waiting. The verdict
 * comes from {@link ../handover/writerLiveness}, the same classifier `handover claim` and the stop gate
 * read, so no surface here re-derives what "gone" means.
 *
 * Pure — no I/O, no clock. `nowIso` and the holder's liveness are supplied by the caller so a frozen fixture
 * judges its own time and its own process table.
 */

import type { RunEvent } from "../handover/ledger.js";
import { currentCycle } from "../handover/ledger.js";
import { inheritedOpen, inheritedQuestion, openQuestionAfter } from "../handover/openQuestion.js";
import type { WriterLiveness } from "../handover/runOwner.js";
import { collapseWhitespace } from "../lib/oneLineSummary.js";
import type { RuleZeroDecision } from "../silver/ruleZero.js";
import { applyRuleZero } from "../silver/ruleZero.js";
import type { TraceEvidence } from "../silver/traceBeforeRanking.js";
import { traceBeforeRanking } from "../silver/traceBeforeRanking.js";
import type { Item } from "./item.js";
import { asItem } from "./item.js";
import type { RankInput, SignalReadings } from "./rank.js";

/**
 * One board doc, reduced to exactly what this leg reads.
 *
 * Deliberately not a {@link ../handover/boardTypes.BoardModel}: that type carries a probe state, a
 * dependency closure and a consistency verdict this leg has no opinion about, and a test that had to build
 * one would be testing the board's shape rather than this leg's rules.
 */
export interface BoardEntry {
  /** The run's slug — how the owner resumes it, and the only name this leg puts in front of the owner. */
  readonly slug: string;
  /**
   * The repository the doc names, as its own `repo:` field gives it — a filesystem path, or undefined.
   *
   * Carried because a bare `#<number>` in a recorded question means a different pull request depending on which
   * repository the run was about, and resolving every one of them against a single repository marks good
   * rows as stale. Two acme-admin rows were flagged that way before this field existed.
   */
  readonly repo: string | undefined;
  /**
   * The doc's own summary prose, or undefined when it never stated one.
   *
   * Optional rather than coalesced to an empty string: "this doc has no summary" and "this doc's summary is
   * blank" are the same fact here, and inventing an empty string to represent it would be the fail-quiet
   * the house rules ban.
   */
  readonly summary: string | undefined;
  /** The journal, in order. The leg finds the current cycle's open question itself. */
  readonly events: readonly RunEvent[];
  /**
   * Whether the session holding the run is still alive, or undefined when the journal names no writer.
   *
   * Required-but-undefined rather than optional, so a caller that has not measured it has to say so instead
   * of a missing field silently meaning "alive". A run with no recorded holder is `undefined` and keeps the
   * ordinary waiting-on-owner reading — there is no dead session in that case, only an unattributed one.
   */
  readonly holder: WriterLiveness | undefined;
}

/**
 * A run's open question, with the instant it was recorded.
 *
 * @internal the public contract for the session-start verb, exported ahead of the consumer that reads it.
 */
export interface OpenQuestion {
  readonly question: string;
  readonly askedAtIso: string;
}

/**
 * The words a doc's own prose uses when it claims the work is already finished.
 *
 * Matched case-insensitively against the summary. Short and blunt on purpose: this list only has to be
 * good enough to send a suspicious doc back for a live read, and a false positive costs one extra read
 * while a false negative puts finished work on the owner's list — the exact failure that struck item 3.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const COMPLETION_CLAIMS: readonly string[] = [
  "already done",
  "already landed",
  "already shipped",
  "has landed",
  "is done",
  "landed as",
  "merged as",
  "shipped as",
];

/**
 * The most `age` this leg will read, in whole days of silence.
 *
 * Every item in this slice is the owner's move by construction, so rule zero says `show` for all of them and the
 * scored signals below are identical across the slice. Age is therefore the ONLY thing that spreads these
 * rows apart, and it spreads them the way the owner would: the question that has been waiting longest goes first.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const AGE_DAYS_CAP = 2;

/**
 * The current cycle's open question, if the run has one.
 *
 * Reads the cycle rather than the whole journal for the reason {@link ../handover/ledger.runStateOf} does:
 * a doc may legitimately be run more than once, and a question answered in an earlier cycle is history. An
 * `answered` — or the holder's `question-withdrawn` — recorded after the question closes it, so the run is not
 * waiting on the owner at all. A question the
 * previous cycle closed still holding is the one piece of history that still counts, through the same
 * {@link inheritedQuestion} the run state reads, so the board and the verbs agree it is waiting.
 *
 * @param events the journal's events, in order
 * @returns the open question and when it was asked, or undefined when nothing is waiting on the owner
 */
export function openQuestion({ events }: { events: readonly RunEvent[] }): OpenQuestion | undefined {
  const cycle = currentCycle({ events });
  const inherited = inheritedQuestion({ events });
  let found: OpenQuestion | undefined =
    inherited === undefined ? undefined : { askedAtIso: inherited.atIso, question: inherited.question };
  // The TEXT is the card fold's, so this leg names the question exactly as the Queue card does: a correction
  // restates it, and a reshape replaces it only over a question carrying no shape — a rule that reads the shape,
  // which this fold does not carry. The asked instant stays this fold's own, set by the `question` event alone.
  let held = inherited === undefined ? undefined : inheritedOpen({ inherited });
  for (const event of cycle) {
    held = openQuestionAfter({ event, open: held });
    if (event.kind === "question") {
      found = { askedAtIso: event.atIso, question: event.question };
    }
    if (found !== undefined && held !== undefined) {
      found = { ...found, question: held.question };
    }
    // A withdrawal settles only the question it names, so it clears this leg exactly when the card fold let go.
    const withdrawn = event.kind === "question-withdrawn" && held === undefined;
    if (
      withdrawn ||
      event.kind === "answered" ||
      event.kind === "finished" ||
      event.kind === "closed" ||
      event.kind === "abandoned"
    ) {
      found = undefined;
    }
  }
  return found;
}

/**
 * Whether a doc's own prose claims the work is already finished.
 *
 * A doc with no summary claims nothing, which is the honest reading — silence is not a completion claim,
 * and treating it as one would send every unsummarised doc back for a live read.
 *
 * @param summary the doc's summary text, or undefined when it stated none
 * @returns true when the prose makes a completion claim nothing has confirmed
 */
export function claimsCompletion({ summary }: { summary: string | undefined }): boolean {
  if (summary === undefined) {
    return false;
  }
  const haystack = summary.toLowerCase();
  return COMPLETION_CLAIMS.some((claim) => haystack.includes(claim));
}

/**
 * The evidence a board item carries into the trace.
 *
 * ## The journal fact is withheld once the prose claims completion, and that is the whole point
 *
 * The obvious build emits both pieces and lets the trace weigh them. It does not work, and the unit case
 * that caught it is kept: {@link ../silver/traceBeforeRanking} lets any provider fact outrank prose, so a
 * journal fact shipped alongside a completion claim silently DISCARDS the claim and the row ranks anyway.
 *
 * The fix is not to reweigh the trace, it is to stop overclaiming here. An unanswered journal proves
 * exactly one thing — **nobody typed an answer into it** — and that is not the same as the question still
 * being live. `slack-huddle-transcript-source` is the worked example: its recorded question had been made
 * moot by events elsewhere two hours later, while its journal sat with no `answered` event for a day. The
 * journal's silence was not evidence the work remained.
 *
 * So when the doc's own prose says the work is finished, the journal establishes nothing about whether the
 * item is real, and the only honest evidence left is the unconfirmed claim itself — which is precisely
 * what earns a live read.
 *
 * @param entry the board doc and its journal
 * @param question the run's open question, already resolved by {@link openQuestion}
 * @returns the evidence, in the order it was traced
 */
export function boardEvidence({
  entry,
  question,
}: {
  entry: BoardEntry;
  question: OpenQuestion;
}): readonly TraceEvidence[] {
  if (claimsCompletion({ summary: entry.summary })) {
    return [
      {
        grade: "machine-account",
        showsResolved: true,
        source: `slopweaver handover resume ${entry.slug}`,
        what: "the doc's own summary says this work is finished, and nothing outside the doc confirms it",
      },
    ];
  }
  if (holderIsGone({ entry })) {
    return [
      {
        grade: "provider-fact",
        showsResolved: false,
        source: `slopweaver handover resume ${entry.slug}`,
        what: `its question at ${question.askedAtIso} was recorded by a session that no longer exists, so nothing is going to answer it or write back to it`,
      },
    ];
  }
  return [
    {
      grade: "provider-fact",
      showsResolved: false,
      source: `slopweaver handover resume ${entry.slug}`,
      what: `its journal records a question at ${question.askedAtIso} and nothing has answered it since`,
    },
  ];
}

/**
 * Whether the session holding this run is known to be gone.
 *
 * Only `dead` counts. `unknown` — a Codex writer no open file shows live, a journal predating host-labelled ownership, a registry
 * that would not decode — is not evidence of anything, and reading it as death would quietly demote every
 * run this machine cannot classify. That is the same asymmetry {@link ../handover/writerLiveness} is built
 * on, and this function exists so the reading is spelled once rather than in each rule below.
 *
 * @param entry the board doc, carrying the liveness its reader measured
 * @returns true only when the holder was measured and found dead
 */
export function holderIsGone({ entry }: { entry: BoardEntry }): boolean {
  return entry.holder?.kind === "dead";
}

/**
 * What this leg measures for one board item.
 *
 * Three of the six are constant across the slice, and that is the honest reading rather than a gap:
 * `directness` because the question was written for the owner and nobody else, `distanceToDone` because one word
 * settles it either way, and `drift` at zero because measuring drift is the cycle leg's job, not this
 * one's. Inventing a spread across signals this leg cannot see would be a rank the owner could not argue with.
 *
 * `stoppedOnOwner` is the one that moves, and it moves on a fact rather than a feeling: it is at its cap
 * while a session is literally stopped, and at ZERO once that session is gone. See the module header — a
 * dead holder cannot be waiting, and this signal is what put three finished rows above real work.
 *
 * @param nowIso the run's own instant, supplied rather than read
 * @param question the run's open question
 * @param holderGone whether the session that recorded the question no longer exists
 * @returns the readings
 */
export function boardReadings({
  nowIso,
  question,
  holderGone,
}: {
  nowIso: string;
  question: OpenQuestion;
  holderGone: boolean;
}): SignalReadings {
  const askedAt = Date.parse(question.askedAtIso);
  const now = Date.parse(nowIso);
  const days = Number.isNaN(askedAt) || Number.isNaN(now) ? 0 : Math.floor((now - askedAt) / 86_400_000);
  return {
    age: Math.min(Math.max(0, days), AGE_DAYS_CAP),
    directness: 3,
    distanceToDone: 3,
    drift: 0,
    explicitPriority: 0,
    stoppedOnOwner: holderGone ? 0 : 5,
  };
}

/**
 * What a board run IS, for a reader who does not remember commissioning it.
 *
 * The doc's own `summary` is that description and it was written when the run was filed, so it says what
 * the work is rather than where it got to. A doc carrying none leaves the row without background, and
 * {@link ./item.asItem} then drops it — which is the correct outcome, because a run nobody can describe is
 * not a row the owner can answer.
 *
 * @param entry the board entry
 * @returns the background, or undefined when the doc describes itself nowhere
 */
export function boardBackground({ entry }: { entry: BoardEntry }): string | undefined {
  if (entry.summary === undefined) {
    return undefined;
  }
  const summary = collapseWhitespace({ text: entry.summary });
  if (summary.length === 0) {
    return undefined;
  }
  const where = entry.repo === undefined ? "" : ` It works in ${entry.repo}.`;
  return `An orchestration run you started, working under the slug ${entry.slug}.${where} What it is for: ${openingSentences({ prose: summary })}`;
}

/**
 * The first two sentences of a doc's summary, which is what a background is allowed to cost.
 *
 * MEASURED on the first live run of this field: a doc's `summary` is its whole filed brief, not a
 * description, and one of them rendered a 200-word paragraph into the row. That is the wall of text rule 7
 * exists to refuse, and it is WORSE than no background — a row the owner will not read is a row they cannot answer,
 * which was the whole complaint. Two sentences is what fits above the fold beside the rest of a row.
 *
 * @param prose the whitespace-collapsed summary
 * @returns its first two sentences, or the whole thing when it is already shorter
 */
export function openingSentences({ prose }: { prose: string }): string {
  const parts = prose.split(/(?<=[.!?])\s+/);
  const kept = parts.slice(0, 2).join(" ").trim();
  return kept.length === 0 ? prose : kept;
}

/**
 * The item one board entry produces, or undefined when it is not waiting on the owner.
 *
 * `where` is the resume COMMAND rather than the doc's path. Two reasons, and the first is the leak class: an
 * absolute home path is one the hygiene scanner flags (`absolute-home-path`, `src/hygiene/scan.ts`), so a
 * path has no business on an outbound surface. The second is that the command
 * is the action anyway — it rebuilds the run's whole brief from its journal, which a path does not.
 *
 * `who` names the session rather than a person, because no person asked: a session working the owner's own fleet
 * did. Saying so plainly beats resolving it to a human the ask did not come from. It names the session's
 * ROLE rather than its slug, and that is the fix for a measured defect rather than a preference: this row's
 * slug is already the whole of `nativeId` and the tail of `where`, so spelling it a third time here made the
 * line restate one identifier twice and made `who` as long as the slug. MEASURED over a real
 * run (`slopweaver session-start --json`, 78 ranked): a 110-character slug produced
 * `the <slug> session` at 122 characters, and `slopweaver briefing render` refused the whole page at
 * `yourList.rows.N.who`, whose cap is 120. Reproduce the length class over any run:
 *
 * ```
 * slopweaver session-start --json | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(Math.max(...d.ranking.ranked.map(e=>[...e.item.who].length)))'
 * ```
 *
 * These two labels are COMPLETE statements rather than shortened ones, which is why no elision or ellipsis
 * appears here. Shortening the slug to fit would have bought the same characters while making the field say
 * less than it knows, and eliding `who` for every leg would have rewritten real people's names
 * ({@link ../slackLeg}'s author, {@link ../gmailLeg}'s sender) to fix one leg that names no person at all.
 * Which session it is stays one field away, exactly and in full.
 *
 * @param entry the board doc and its journal
 * @returns the item, or undefined when the run has no open question or the item is incomplete
 */
export function boardItem({ entry }: { entry: BoardEntry }): Item | undefined {
  const question = openQuestion({ events: entry.events });
  if (question === undefined) {
    return undefined;
  }
  const background = boardBackground({ entry });
  const gone = holderIsGone({ entry });
  return asItem({
    candidate: {
      ...(background === undefined ? {} : { background }),
      doneWhen: question.question,
      nativeId: entry.slug,
      provenance: "board leg — the WAITING ON OWNER slice of the handover board",
      source: "handover",
      state: gone ? "its session is gone — resume it or abandon it" : "waiting on owner",
      whenIso: question.askedAtIso,
      where: `slopweaver handover resume ${entry.slug}`,
      who: gone ? "nobody — its session is gone" : "the session holding it",
      ...(entry.repo === undefined ? {} : { repo: entry.repo }),
    },
  });
}

/**
 * Rule zero for a board item.
 *
 * Always the owner's move, and that is not an assumption — the slice is DEFINED as the runs stopped on the owner, so
 * anything else would contradict the register this leg reads. Kept as a real call rather than a hardcoded
 * `show` so the reason on the row comes from the same place every other row's does.
 *
 * @param nowIso the run's own instant
 * @param question the run's open question
 * @returns the decision, which is always `show`
 */
export function boardRuleZero({ nowIso, question }: { nowIso: string; question: OpenQuestion }): RuleZeroDecision {
  return applyRuleZero({ lastMovedIso: question.askedAtIso, move: { party: "owner" }, nowIso });
}

/**
 * Turn the whole `WAITING ON OWNER` slice into ranker input.
 *
 * `finishesInFlight` is true for every row, and it is the tiebreak that carries the north star: wrapping up
 * in-flight work rather than chasing new shiny things.
 * A run stopped on a question is in-flight work by definition — answering it is the smallest act that
 * moves it.
 *
 * `unverified` is false throughout: the journal is read directly from disk, so no cursor stands between
 * this leg and the fact it reports. That is what makes this the highest-precision leg in the system.
 *
 * A row whose holder is gone still comes through, demoted rather than dropped. Silently omitting it would
 * lose the one thing only the owner can settle about an abandoned run — whether to resume it or abandon it — and a
 * row that is absent from the list is a row the owner never gets to rule on.
 *
 * @param entries every board doc in the slice, with its journal
 * @param nowIso the run's own instant, supplied rather than read
 * @returns one rank input per doc that is genuinely waiting on the owner, in the order given
 */
export function boardLeg({
  entries,
  nowIso,
}: {
  entries: readonly BoardEntry[];
  nowIso: string;
}): readonly RankInput[] {
  const inputs: RankInput[] = [];
  for (const entry of entries) {
    const question = openQuestion({ events: entry.events });
    const item = boardItem({ entry });
    if (question === undefined || item === undefined) {
      continue;
    }
    inputs.push({
      finishesInFlight: true,
      item,
      readings: boardReadings({ holderGone: holderIsGone({ entry }), nowIso, question }),
      ruleZero: boardRuleZero({ nowIso, question }),
      trace: traceBeforeRanking({ evidence: boardEvidence({ entry, question }) }),
      unverified: false,
    });
  }
  return inputs;
}
