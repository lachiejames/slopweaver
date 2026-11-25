/**
 * How `slopweaver github landing` prints — the table a supervisor scans at boot, and the document a
 * machine reads. Pure: every function here takes rows and returns strings.
 *
 * The table's job is that the ACT column is readable top to bottom without opening a single pull request,
 * because that is the whole ruling: the reader should have little to infer. Everything a row needs to
 * justify its act rides in the same line — who is blocking it, which check failed, what CodeRabbit said —
 * and the fuller `why` per test lives in `--json` for a consumer that wants it.
 */

import type { RepoCensus } from "../../../live/github/openCensus.js";
import { slackIdsOf } from "../../../review/askTrail.js";
import type { LandingRow, LandingTally } from "../../../review/landing.js";
import { supervisorDispatchRows } from "../../../review/landingDispatch.js";
import type { ConversationTally } from "../../../review/reviewSignals.js";
import type { CiVerdict } from "../../../review/reviewState.js";
import type { LandingSettlement } from "./landingClosureRun.js";
import { landingFacts, queueCell, RABBIT_CELL } from "./landingFacts.js";
import { type LandingRegistration, settledAtThisHead } from "./landingRegister.js";

/** Pad a cell to a fixed width so the table lines up in a terminal without a formatting library. */
function pad({ text, width }: { text: string; width: number }): string {
  return text.length >= width ? text.slice(0, width) : text + " ".repeat(width - text.length);
}

/** The one-word CI cell for a rollup that is not red. */
const CI_CELL: Readonly<Record<Exclude<CiVerdict, "red">, string>> = {
  green: "green",
  none: "none",
  running: "running",
};

/**
 * The one-word CI cell, upper-cased where a reader must not skim past it.
 *
 * A red rollup is split three ways by the row's own `ciFailure` (`../../../review/landingCiFailure.ts`):
 * `REQUIRED` when a check the base requires failed, `advisory` when every failing check is known advisory, and
 * `RED?` when the read cannot tell — never `advisory` by default, because an unread required set is not a
 * measured absence of one.
 *
 * @param row the broken-down pull request
 * @returns the cell
 */
export function ciCell({ row }: { row: LandingRow }): string {
  if (row.ci !== "red") {
    return CI_CELL[row.ci];
  }
  if (row.ciFailure.kind === "red" && row.ciFailure.required === true) {
    return "REQUIRED";
  }
  if (row.ciFailure.kind === "red" && row.ciFailure.required === false) {
    return "advisory";
  }
  return "RED?";
}

/** The CI clause a `spawn-ci` row's trailing cell opens with, in the words its classification supports. */
function ciWhyClause({ row }: { row: LandingRow }): string {
  const cell = ciCell({ row });
  const required = row.failingChecks.filter((check) => check.required === true).map((check) => check.name);
  if (cell === "REQUIRED" && required.length > 0) {
    return `required check failing: ${required.join(", ")}`;
  }
  if (cell === "REQUIRED") {
    return `required check failing: ${row.actionDetail}`;
  }
  const names = row.failingChecks.map((check) => check.name).join(", ");
  if (cell === "advisory") {
    return `advisory check failing: ${names}`;
  }
  return names === "" ? "failing check requirement unknown" : `failing check requirement unknown: ${names}`;
}

/** The header the table prints above its rows. */
export const LANDING_HEADER =
  `${pad({ text: "PR", width: 9 })} ${pad({ text: "ACT", width: 19 })} ${pad({ text: "CI", width: 8 })} ` +
  `${pad({ text: "RABBIT", width: 8 })} ${pad({ text: "QUEUE", width: 12 })} ${pad({ text: "BOARD", width: 7 })} ` +
  "BLOCKED ON / WHY";

/**
 * The BOARD cell — whether a handover row STATES this pull request's branch.
 *
 * `none?` rather than `none` on purpose: the join is a declared `branch:` or a run's recorded one, so a doc
 * that stated neither is
 * invisible to it. The question mark is the difference between "there is no row" and "no row says so",
 * which is exactly what decides whether spawning an investigation duplicates work.
 *
 * @param row the broken-down pull request
 * @returns the cell
 */
export function boardCell({ row }: { row: LandingRow }): string {
  return row.boardRow.kind === "row" ? row.boardRow.status : "none?";
}

/**
 * The trailing cell: who is holding it, or the sentence behind its act when nobody is.
 *
 * **`blocked-on` and `answer-threads` are answered differently, and the split is the point.** On an
 * `answer-threads` row the reviewer NAMES are the whole information, so the cell is the names. On a
 * `blocked-on` row the names alone read as a bare mention of a team — it printed
 * `@acme/acme-eng · Update dependency …` and said nothing about what that team owes — so the cell
 * is `actionDetail`, which is the `codeowners-satisfied` test's own sentence and therefore opens with
 * `AWAITING_HUMAN_REVIEW` (`../../../review/landingTests.ts`) and still names every owner. That is the owner's
 * ruling reaching the surface they actually read.
 *
 * @param row the broken-down pull request
 * @returns the cell
 */
export function whyCell({ row }: { row: LandingRow }): string {
  if (row.action === "spawn-ci" && row.ci === "red") {
    return `${ciWhyClause({ row })} · ${row.title}`;
  }
  if (row.blockedOn.length > 0 && row.action === "answer-threads") {
    return `${row.blockedOn.join(", ")} · ${row.title}`;
  }
  return `${row.actionDetail} · ${row.title}`;
}

/**
 * One pull request as a single table line.
 *
 * @param row the broken-down pull request
 * @returns the row
 */
export function landingRowLine({ row }: { row: LandingRow }): string {
  return (
    `${pad({ text: `#${String(row.number)}`, width: 9 })} ` +
    `${pad({ text: row.action, width: 19 })} ` +
    `${pad({ text: ciCell({ row }), width: 8 })} ` +
    `${pad({ text: RABBIT_CELL[row.codeRabbit], width: 8 })} ` +
    `${pad({ text: queueCell({ row }), width: 12 })} ` +
    `${pad({ text: boardCell({ row }), width: 7 })} ` +
    whyCell({ row })
  );
}

/**
 * The summary line under the table — what the read found, without listing it again.
 *
 * The advisory-red count is appended when non-zero, because `ci-green` passes those rows
 * (`../../../review/landingTests.ts`) and a line counting no red build beside red heads would be false.
 *
 * @param tally the counts this read produced
 * @returns one line
 */
export function landingTallyLine({ tally }: { tally: LandingTally }): string {
  const acts = tally.byAction.map((entry) => `${entry.action} ${String(entry.count)}`).join(" · ");
  const line = `${String(tally.total)} open · ${String(tally.ready)} ready · ${acts}`;
  if (tally.advisoryRedBypassed === 0) {
    return line;
  }
  return `${line} · advisory-only red, not holding ${String(tally.advisoryRedBypassed)}`;
}

/**
 * The DISPATCH totals, printed under the act totals.
 *
 * Its own line rather than more cells on the act line, because the two answer different questions and the
 * supervisor acts on this one: how many rows it may send to a session, and how many it must card.
 *
 * `spawnable` is COUNTED by the caller rather than derived from the tally, because a row this run pressed is
 * no longer one to send anybody — and deriving it here from the per-verdict counts would report a pressed
 * `merge-now` as still needing a session, in the same output that reports the press. A Codex review found
 * exactly that, fixed in `--json` and still wrong on this line.
 *
 * @param tally the counts this read produced
 * @param spawnable how many rows are actually left to send, which is `LandingDocument.dispatchable`'s length
 * @returns one line, or the sentence that says no row carried a verdict at all
 */
export function landingDispatchLine({ tally, spawnable }: { tally: LandingTally; spawnable: number }): string {
  if (tally.byDispatch.length === 0) {
    return "dispatch: no row carried a dispatch verdict";
  }
  const verdicts = tally.byDispatch.map((entry) => `${entry.verdict} ${String(entry.count)}`).join(" · ");
  const judgement = tally.byDispatch.find((entry) => entry.verdict === "needs-owner-judgment");
  const carded = judgement === undefined ? 0 : judgement.count;
  return `dispatch: ${verdicts} — ${String(spawnable)} to spawn, ${String(carded)} to card`;
}

/**
 * The second line under one pull request: the dispatch verdict, and the facts it turned on.
 *
 * A second LINE rather than more columns, so the `ACT` column above still scans top to bottom unchanged —
 * that readability is the owner's own ruling and this addition may not cost it.
 *
 * @param row the broken-down pull request
 * @returns the line, indented under its row
 *
 * @internal exported for its own unit test; `landingTable` is what a caller prints.
 */
export function landingDispatchLineFor({ row }: { row: LandingRow }): string {
  const cells = [
    dispatchCell({ row }),
    `cr ${threadCell({ tally: row.conversations.codeRabbit })}`,
    `hu ${threadCell({ tally: row.conversations.humans })}`,
    `base ${baseCell({ row })}`,
    `ask ${askCell({ row })}`,
  ];
  return `          ${cells.join(" · ")}`;
}

/**
 * The verdict cell, upper-cased for the one arm that is the owner's to answer, and ALWAYS carrying its reason.
 *
 * The reason is the cell's whole value on the arm that matters: a line reading only the owner's-judgment verdict and
 * nothing else tells the owner a decision is theirs without saying what it is about, and a standing
 * changes-requested that put a row there would never reach the terminal. The reason prints for the non-act
 * kinds and for every act alike.
 *
 * @param row the broken-down pull request
 * @returns the cell
 */
function dispatchCell({ row }: { row: LandingRow }): string {
  if (row.dispatch.kind !== "act") {
    return `${row.dispatch.kind}: ${row.dispatch.why}`;
  }
  const verdict = row.dispatch.verdict === "needs-owner-judgment" ? "NEEDS-OWNER-JUDGMENT" : row.dispatch.verdict;
  return `${verdict}: ${row.dispatch.why}`;
}

/** One side of the conversation, as `open(awaiting/answered/their-last-word) resolved` counts. */
function threadCell({ tally }: { tally: ConversationTally }): string {
  const open = `${String(tally.open)} open`;
  const split = `${String(tally.awaitingUs)}↤ ${String(tally.answeredOpen)}↦ ${String(tally.reviewerLastWord)}↩`;
  return `${open} (${split}) ${String(tally.resolved)} done`;
}

/** How far the head is behind its base, or that it was not read. */
function baseCell({ row }: { row: LandingRow }): string {
  if (row.baseDistance.kind === "unread") {
    return "unread";
  }
  const { aheadBy, behindBy } = row.baseDistance.value;
  return `+${String(aheadBy)}/-${String(behindBy)}`;
}

/**
 * Whether the Slack legs found an ask, and whether a chase is due — in the words the evidence supports.
 *
 * Slack alone: a GitHub review request is not an ask (an owner ruling), so it is never counted.
 */
function askCell({ row }: { row: LandingRow }): string {
  const asked = `in Slack: ${row.slack.asked}`;
  if (row.bump.kind === "due") {
    return `${asked}, chase DUE`;
  }
  if (row.bump.kind === "unknown") {
    return `${asked}, chase unknown`;
  }
  return `${asked}, ${row.bump.kind}`;
}

/**
 * The whole table, one repository at a time so a reader never has to check which repo a number belongs to.
 *
 * @param rows every row this read produced
 * @returns the lines to print, in order
 */
export function landingTable({ rows }: { rows: readonly LandingRow[] }): readonly string[] {
  const lines: string[] = [];
  for (const slug of new Set(rows.map((row) => row.repoSlug))) {
    const inRepo = rows.filter((row) => row.repoSlug === slug);
    lines.push(`${slug} — ${String(inRepo.length)} open`);
    lines.push(LANDING_HEADER);
    for (const row of inRepo) {
      lines.push(landingRowLine({ row }));
      lines.push(landingDispatchLineFor({ row }));
    }
    lines.push("");
  }
  return lines;
}

/** One press, as this run performed or would have performed it. */
export interface LandingPressOutcome {
  readonly repoSlug: string;
  readonly number: number;
  readonly url: string;
  /**
   * `pressed`, `would-press` under `--dry-run`, or `failed` with the reason on {@link detail} — and, for a
   * stuck CodeRabbit review (`./landingCodeRabbitNudge.ts`), `nudged`, `would-nudge` or `flipped-by-itself`.
   */
  readonly outcome: "pressed" | "would-press" | "nudged" | "would-nudge" | "flipped-by-itself" | "failed";
  readonly detail: string;
}

/**
 * The outcomes that leave nothing to seat a session for this pass: an accepted press, and a re-requested or
 * self-flipped CodeRabbit review. A `would-*` wrote nothing, so its row stays dispatchable.
 */
const SETTLED_OUTCOMES = new Set<LandingPressOutcome["outcome"]>(["pressed", "nudged", "flipped-by-itself"]);

/**
 * What `--if-due` emits on a tick whose cadence has not elapsed.
 *
 * A DIFFERENT document rather than an empty read, and that is the whole point of the field. A skipped tick
 * emitting `{ rows: [], dispatchable: [] }` would be indistinguishable from a read that found nothing
 * outstanding — a consumer would conclude the fleet was clear on a tick that never looked at it, which is
 * the failure class this verb's cadence exists inside rather than a new one.
 */
export interface LandingSkippedDocument {
  readonly kind: "skipped";
  /** When this selection was last read. */
  readonly lastReadAtIso: string;
  /** When it next will be. */
  readonly nextDueAtIso: string;
  readonly cadenceMinutes: number;
  /** The selection, as `../../../review/readJournal.ts` keys one. */
  readonly selection: string;
  readonly why: string;
}

/**
 * One row as the document carries it: every field of the row, plus its one-line `facts` (`./landingFacts.ts`).
 *
 * A projection rather than a field on {@link LandingRow}, because the line is presentation computed FROM the
 * row, and the supervisor's tick digest prints it rather than re-deriving its own summary of the same row.
 */
type LandingDocumentRow = LandingRow & { readonly facts: string };

/** The whole machine-readable document. */
export interface LandingDocument {
  /** Present so a consumer can tell a read from a {@link LandingSkippedDocument} without inferring it. */
  readonly kind: "read";
  readonly rows: readonly LandingDocumentRow[];
  readonly tally: LandingTally;
  /** What the run itself could not see — never a per-row limit, which rides on the row. */
  readonly residue: readonly string[];
  /** Present only when `--press` was given. */
  readonly presses: readonly LandingPressOutcome[];
  /**
   * The rows the supervisor spawns a session for — every `act` verdict except the one that is the owner's to judge.
   *
   * Carried as its own array rather than left for a consumer to filter, so the predicate exists in exactly one
   * place: a reader that re-derived "every verdict but the owner's" would be a second opinion about which rows
   * are carded.
   *
   * A row whose press call `github enqueue` ACCEPTED is excluded. Under `--press` the rows are judged before
   * the click, so it would otherwise still be listed as work to spawn a session for — a contradiction inside
   * one document, found by a Codex review. `landing` reads only the exit code, so "accepted" covers both
   * "queued it" and "found it already queued"; neither leaves anything to send a session for, which is why
   * one predicate is right for both. A stuck CodeRabbit review this run re-requested, or that flipped by
   * itself during the wait, is excluded for the same reason (`./landingCodeRabbitNudge.ts`).
   *
   * So is a row whose own registration at this head already ended on the board — settled, closed or
   * abandoned (`./landingRegister.ts`'s `settledAtThisHead`). A seat for it is refused by `cmux spawn`, so
   * listing it only inflates the count the console shows as open work.
   */
  readonly dispatchable: readonly LandingDocumentRow[];
  /**
   * What `--register` wrote to the board, empty when it was not given.
   *
   * Every row `--register` CONSIDERED is here, `skipped` ones included with the sentence saying why — so
   * "nothing was written this tick" and "there was nothing to write" are never the same answer.
   */
  readonly registrations: readonly LandingRegistration[];
  /**
   * What `--register` did about landing rows whose pull request has ENDED, empty when it was not given.
   *
   * The other end of {@link registrations}: a row filed for an open pull request is settled here once GitHub reads
   * it merged or closed, the merge commit or close instant as witness (`../../../review/landingClosure.ts`).
   */
  readonly settlements: readonly LandingSettlement[];
  /**
   * What this read selected — the repositories, the author qualifier and whether drafts were asked for.
   *
   * Carried on the document because a consumer reads the LAST document under a producer, whatever
   * invocation took it, and two invocations of this verb legitimately differ: the supervisor tick presses,
   * and `--press` refuses `--include-drafts`, so a tick reading holds no draft at all. Without this field
   * that reading's Drafts group prints a measured zero, which is the confident wrong row the console
   * exists to end.
   */
  readonly selection: LandingSelection;
  /**
   * GitHub's own open list for every selected repository — every author, drafts in — read on the same run.
   *
   * The rows answer "what is next for each of the owner's"; this answers "how many does GitHub say are open", and the two must always agree.
   * The console prints the part of it {@link selection}'s author
   * matches — the owner's open count, drafts in — and counts the other authors' apart. A matching pull
   * request here and not in {@link rows} is one this read did not place, and a consumer names it rather than
   * counting it into a group (`../../../live/github/openCensus.ts`).
   */
  readonly census: readonly RepoCensus[];
  /**
   * The name the derived roster holds for every Slack id some row's `askTrail` asked, keyed by that id.
   *
   * Carried on the document so a consumer prints "asked Rosa Lindqvist" from the SAME read that found the ask,
   * rather than joining a second roster read that may disagree. Only ids the roster actually names appear:
   * an unnamed id is left out, and a reader draws the bare id rather than a name nobody resolved.
   */
  readonly people: Readonly<Record<string, { readonly name: string }>>;
  /**
   * The Slack id the roster holds for every pull request's author and every PERSON GitHub named as a code
   * owner, keyed by lower-cased login. What `github reviewer` reads to suggest a named code owner, and to
   * never suggest the author, without loading the roster itself. An unresolved login is left out.
   */
  readonly logins: Readonly<Record<string, string>>;
  /**
   * EVERY Slack id the roster holds for the same logins — one person can carry two. What `github reviewer`
   * reads to leave the author out under any of their ids; {@link logins} stays the one id that addresses them.
   */
  readonly loginSlackIds: Readonly<Record<string, readonly string[]>>;
}

/**
 * The individual people among a row's code owners — `@login` tokens, never an `@org/team`.
 *
 * @param blockedOn the row's `@`-prefixed code owners
 * @returns the logins, lower-cased, without the `@`
 */
function codeOwnerLoginsOf({ blockedOn }: { blockedOn: readonly string[] }): readonly string[] {
  return blockedOn.filter((token) => !token.includes("/")).map((token) => token.replace(/^@/, "").toLowerCase());
}

/**
 * The Slack ids the roster holds for every author and individual code owner in one read —
 * {@link LandingDocument.logins}.
 *
 * @param rows every row this read produced
 * @param slackIdForLogin the roster's lower-cased login → Slack id join
 * @returns one entry per login the roster resolves
 */
export function loginSlackIdsOf({
  rows,
  slackIdForLogin,
}: {
  rows: readonly LandingRow[];
  slackIdForLogin: ReadonlyMap<string, string>;
}): Readonly<Record<string, string>> {
  const logins: Record<string, string> = {};
  for (const row of rows) {
    for (const login of [row.authorLogin.toLowerCase(), ...codeOwnerLoginsOf({ blockedOn: row.blockedOn })]) {
      const slackId = slackIdForLogin.get(login);
      if (slackId !== undefined) {
        logins[login] = slackId;
      }
    }
  }
  return logins;
}

/**
 * Every Slack id the roster holds for every author and individual code owner in one read —
 * {@link LandingDocument.loginSlackIds}.
 *
 * @param rows every row this read produced
 * @param slackIdsForLogin the roster's lower-cased login → every Slack id join
 * @returns one entry per login the roster resolves
 */
export function everyLoginSlackIdOf({
  rows,
  slackIdsForLogin,
}: {
  rows: readonly LandingRow[];
  slackIdsForLogin: ReadonlyMap<string, readonly string[]>;
}): Readonly<Record<string, readonly string[]>> {
  const out: Record<string, readonly string[]> = {};
  for (const row of rows) {
    for (const login of [row.authorLogin.toLowerCase(), ...codeOwnerLoginsOf({ blockedOn: row.blockedOn })]) {
      const slackIds = slackIdsForLogin.get(login);
      if (slackIds !== undefined) {
        out[login] = slackIds;
      }
    }
  }
  return out;
}

/**
 * The names a document carries — {@link LandingDocument.people}: every ask trail's recipients, and every
 * Slack id {@link LandingDocument.logins} resolved, so a suggested code owner prints by name too.
 *
 * @param rows every row this read produced
 * @param nameForSlackId the roster's Slack id → display name join
 * @param logins the login → Slack id map the same document carries
 * @returns one entry per id the roster names
 */
export function askPeopleOf({
  rows,
  nameForSlackId,
  logins,
}: {
  rows: readonly LandingRow[];
  nameForSlackId: ReadonlyMap<string, string>;
  logins: Readonly<Record<string, string>>;
}): Readonly<Record<string, { readonly name: string }>> {
  const people: Record<string, { readonly name: string }> = {};
  const ids = new Set([...slackIdsOf({ trails: rows.map((row) => row.askTrail) }), ...Object.values(logins)]);
  for (const id of ids) {
    const name = nameForSlackId.get(id)?.trim();
    if (name !== undefined && name !== "") {
      people[id] = { name };
    }
  }
  return people;
}

/** The selection one `github landing` read was taken over — the three inputs that change which rows exist. */
export interface LandingSelection {
  readonly repos: readonly string[];
  /** The `--author` qualifier as typed — GitHub's own `@me` or a login — or absent for every author. */
  readonly author: string | undefined;
  readonly includeDrafts: boolean;
}

/**
 * Assemble the document `--json` emits.
 *
 * @param rows every row this read produced
 * @param tally the counts
 * @param residue what the run could not see
 * @param presses what `--press` did, empty when it was not given
 * @param registrations what `--register` did, empty when it was not given
 * @param selection what the read was taken over, so a consumer of the last document knows its bounds
 * @param census GitHub's own open list per selected repository, every author and drafts in
 * @param people the names the roster holds for the ask trails' recipients — {@link askPeopleOf}
 * @param logins the Slack ids the roster holds for authors and named code owners — {@link loginSlackIdsOf}
 * @param loginSlackIds every Slack id the roster holds for the same logins — {@link everyLoginSlackIdOf}
 * @returns the document to serialise
 */
export function landingDocument({
  rows,
  tally,
  residue,
  presses,
  selection,
  census,
  people,
  logins,
  loginSlackIds,
  registrations = [],
}: {
  rows: readonly LandingRow[];
  tally: LandingTally;
  residue: readonly string[];
  presses: readonly LandingPressOutcome[];
  selection: LandingSelection;
  census: readonly RepoCensus[];
  people: Readonly<Record<string, { readonly name: string }>>;
  logins: Readonly<Record<string, string>>;
  loginSlackIds: Readonly<Record<string, readonly string[]>>;
  registrations?: readonly LandingRegistration[];
}): LandingDocument {
  const settled = presses.filter((press) => SETTLED_OUTCOMES.has(press.outcome));
  const pressed = new Set(settled.map((press) => `${press.repoSlug}#${String(press.number)}`));
  return {
    census,
    // A row this run pressed, or one whose own registration at this head the board already holds an ending
    // for, is not work left to send anybody — `./landingRegister.ts`'s `settledAtThisHead` says why.
    dispatchable: supervisorDispatchRows({ rows })
      .filter((row) => !pressed.has(`${row.repoSlug}#${String(row.number)}`) && !settledAtThisHead({ row }))
      .map((row) => ({ ...row, facts: landingFacts({ row }) })),
    kind: "read",
    loginSlackIds,
    logins,
    people,
    presses,
    registrations,
    residue,
    rows: rows.map((row) => ({ ...row, facts: landingFacts({ row }) })),
    selection,
    settlements: [],
    tally,
  };
}
