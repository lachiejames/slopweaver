/**
 * Turning a landing row the supervisor may dispatch into a row on the ONE board.
 *
 * ## Why registering, and never spawning
 *
 * The supervisor gets an update every tick showing which pull requests are mergeable and which need a session
 * spawned to fix red CI, comments or a rebase. The read half is `../../../review/readJournal.ts`; this is the
 * half that makes what it finds ACTIONABLE without anybody remembering to act.
 *
 * There is deliberately no flag here that opens a session, and three reasons say so:
 *
 * - **One board.** `AGENTS.md` writes no status document: it adds a row. A landing row that needs a
 *   session is an ordinary ready row. Made one, it ranks beside the owner's kept outcomes, the due asks and
 *   everything else the sweep's fill step already chooses between.
 * - **Capacity is measured later in the tick than this runs.** The landing read is sweep step 7 and
 *   `machine capacity` is step 8, so a spawn here would happen before the reading that can HOLD it.
 * - **A second verb would cost a second fleet read**, which is the thing being rationed.
 *
 * ## `merge-now` is not registered, and that is canon rather than an omission
 *
 * Sweep step 7: a green, gold-anchored, mergeable pull request goes straight to `github enqueue`, with no seat
 * to wait for and no wave to be in, and inventing a seat lane is the failure measured once, when ten
 * already-green sessions sat idle for hours. So a `merge-now` row is a press (`--press`), never a board row.
 *
 * ## These rows are not `--finding` rows, and the distinction is load-bearing
 *
 * `--finding` exists because a row nobody asked for became a pull request on a team-reviewed base under the
 * owner's name with no memory of asking for it (`../../../handover/findingGate.ts`). Its gate then refuses a
 * team-facing door on that row's branch until the owner rules.
 *
 * Neither half of that applies here. The pull request ALREADY EXISTS, it is already team-facing, and it is
 * already the owner's — nothing new reaches a teammate because a row was written about it. And `AGENTS.md`
 * rule 10 names this exact work: on the owner's own team-facing pull requests the fleet clears CodeRabbit
 * changes, comments, red CI, conflicts, rebases and restacks itself. Marking these rows findings would make the
 * gate refuse the very work rule 10 says to do.
 *
 * ## They are `--dispatch` rows, and that flag exists because THIS verb was refused without it
 *
 * MEASURED: `handover register`'s shape gate treated
 * "not a finding" as "a decision waiting on the owner's word", so the argv composed below — an `--ask` with no
 * `--problem`/`--options`/`--lean` — was refused with exit 2 on EVERY row, and the landing register had
 * never put a row on the board at all. `registerOne` then reported it as "a slug that already exists",
 * naming a cause it had not observed, so the read looked like benign de-duplication.
 *
 * The distinction this file's previous section draws is mechanical: a finding's
 * PROVENANCE and a row's need for a DECISION are different properties, and `--dispatch` declares the second
 * without the first. `../handover/askRowArgs.ts` refuses it beside `--finding` or any shape flag, so a real
 * question cannot ride in under it.
 *
 * {@link registrationArgv} is exported for the one test that would have caught this: the composed argv run
 * through the real `bin/slopweaver` rather than through an injected writer that returns a number.
 *
 * `draft-first-review-ask` and `finish-or-card-close` register exactly the same way, and the owner decision
 * each can END in is still not this row's. Registration cannot honestly author a recipient, a message or a
 * close case, so the seated session gathers that evidence and parks its own `slack draft record` ask (or
 * discussion opener) or records its own `handover ask --action` close card —
 * which is why this row declares nothing waits on the owner, and why its `why` says "never send" and "never close".
 *
 * ## De-duplication is two existing facts, not a new register
 *
 * A row is skipped when a LIVE handover row already states its head branch — declared, or recorded by its run — the join
 * `../../../review/landing.ts` already computes and prints. And the slug carries the head, so
 * `handover register`'s own refusal on an existing file makes a re-register at the same head idempotent,
 * while a settled row over a head that has since MOVED does not hold a still-broken pull request back.
 *
 * A row settled at the SAME head is the other half, and it leaves the dispatchable selection altogether
 * ({@link settledAtThisHead}). A settled ask keeps `status: ready` in its own file on purpose
 * (`../../../handover/askRow.ts`), so the join reads the DERIVED status, and a row that already ended at the
 * head being judged — by its slug or by its settlement's witness — is not work left to send anybody. MEASURED: one read listed 12
 * `rebase-and-fix` rows as dispatchable, 10 of them settled `answered` — every fill attempt was refused by
 * `cmux spawn` as already settled, and the console's dispatchable count overstated the fleet's open work.
 *
 * Pure except {@link performRegistrations}, which owns the writes.
 */

import { repositoryWorkspaceArgv } from "../../../handover/workspace.js";
import type { Result } from "../../../lib/result.js";
import type { Organisation } from "../../../organisation/core.js";
import type { OrganisationError } from "../../../organisation/errors.js";
import { aboutThisHead, registrationSlug, SLUG_HEAD_CHARS } from "../../../review/boardAtHead.js";
import type { LandingRow } from "../../../review/landing.js";
import {
  boardRowIsTerminal,
  boardRowNeedsReseat,
  type LandingBoardRow,
  liveBoardHold,
} from "../../../review/landingBoard.js";
import { REGISTER_CAP } from "./landingUsage.js";

/** The board join that could not be made, with the line explaining it, written once rather than per row. */
const NO_BOARD_ROW: LandingBoardRow = {
  kind: "none-declared",
  why:
    "no handover row states this branch — the join is a declared `branch:` or the branch a run recorded at " +
    "`handover start`, so a row that named neither is invisible here and this is not proof no row exists",
};

/** What happened to one row `--register` considered. */
export interface LandingRegistration {
  readonly repoSlug: string;
  readonly number: number;
  readonly url: string;
  readonly slug: string;
  readonly outcome: "registered" | "would-register" | "skipped" | "failed";
  readonly detail: string;
}

/**
 * The summary the board carries for one row, in plain words with the act first.
 *
 * It carries the dispatch's own `why` because this string is the WHOLE brief a seated landing session gets:
 * `handover register` takes an `--ask` and no body, so whatever is not in this line is a thing the seat has
 * to re-derive — or invent. MEASURED: a seat holding one pull request reported
 * "waiting on a re-approval" for four hours while GitHub showed two approvals, every check green and
 * merging held on nothing but unresolved self-review threads and an out-of-date branch. The verdict word
 * alone told it which act; only the `why` says what the act is ABOUT, and it is the sentence the read already
 * authored for exactly this reader.
 *
 * @param row the landing row
 * @returns the one-line ask
 */
export function registrationAsk({ row }: { row: LandingRow }): string {
  const head = `${row.repoSlug}#${String(row.number)}`;
  if (row.dispatch.kind !== "act") {
    return `${head} needs unknown: ${row.title}`;
  }
  // The dash rides on the CLAUSE rather than in the template, for the reason `landingDispatch.ts`'s
  // `rebase-and-fix` arm records against itself: a blind template printed `rebase-and-fix:  — it is 51
  // commit(s) behind` on a pull request when a clause it joined had nothing to say. Every act
  // arm authors a `why` today, so this is the sentence's shape rather than a fallback for a missing one.
  if (row.dispatch.why === "") {
    return `${head} needs ${row.dispatch.verdict}: ${row.title}`;
  }
  return `${head} needs ${row.dispatch.verdict}: ${row.title} — ${row.dispatch.why}`;
}

/**
 * Whether a board row may be about a pull request in this repository, judged by what its `repo:` resolves to.
 *
 * A row is excluded only when its `repo:` PROVABLY names another repository — resolved to an `owner/name` by
 * `./landingDeps.ts`, through a checkout's own `origin` (so a linked worktree resolves to the repository it
 * belongs to) or the slug or remote it spells. A row naming nothing that resolves stays in: exactly as
 * ambiguous as the branch-only join always was, and never less.
 *
 * @param row the board row, carrying the repository its `repo:` resolved to when it resolved
 * @param repoSlug the pull request's `owner/name`
 * @returns false only when the row is provably about another repository
 */
function aboutThisRepository({ row, repoSlug }: { row: LandingBoardRow; repoSlug: string }): boolean {
  if (row.kind !== "row" || row.repoSlug === undefined) {
    return true;
  }
  return row.repoSlug.toLowerCase() === repoSlug.toLowerCase();
}

/**
 * The one board row a pull request at this head joins to, out of every row declaring its branch.
 *
 * A branch can carry several rows — a landing slug names its head, so a pull request rebased twice has two —
 * and which one the join reported used to be whichever the board scan read last. The order here is meaning
 * instead: a LIVE row that HOLDS the branch wins, because somebody is on it; then a live row parked at rest with
 * no wake, which holds nothing and whose reseat the read names — only when no other live row holds the branch,
 * or that reseat would seat a second session beside a working one; then a row about THIS
 * head, because its ending is the one about the commit being judged; then any other terminal row.
 *
 * Only rows about the pull request's OWN repository take part. A branch name is not unique across
 * repositories — `renovate/zod-4.x` is open in both — so a live row declaring it for another repository must
 * not mask this one's settled row, nor stand in for a row this repository never filed.
 *
 * @param rows every board row declaring the pull request's head branch, each with its derived status — absent
 *   when none declares it
 * @param head the pull request, whose registration slug names the row filed at this head
 * @returns the joined row, or `none-declared` when no row about this repository states the branch
 */
export function boardRowForHead({
  rows,
  head,
}: {
  rows: readonly LandingBoardRow[] | undefined;
  head: Pick<LandingRow, "headOid" | "number" | "repoSlug">;
}): LandingBoardRow {
  const mine = rows?.filter((row) => aboutThisRepository({ repoSlug: head.repoSlug, row }));
  if (mine === undefined) {
    return NO_BOARD_ROW;
  }
  const live = mine.filter((row) => row.kind === "row" && !boardRowIsTerminal({ status: row.status }));
  const holding = live.find((row) => !boardRowNeedsReseat({ boardRow: row }));
  if (holding !== undefined) {
    return holding;
  }
  const [orphaned] = live;
  if (orphaned !== undefined) {
    return orphaned;
  }
  const atThisHead = mine.find((row) => row.kind === "row" && aboutThisHead({ head, row }));
  if (atThisHead !== undefined) {
    return atThisHead;
  }
  const [first] = mine;
  if (first === undefined) {
    return NO_BOARD_ROW;
  }
  return first;
}

/**
 * The board join for one read: every pull request's row, out of ONE board scan.
 *
 * @param deps the board read, keyed by the branch each row declares
 * @param home the state home the board is read from
 * @returns the row {@link boardRowForHead} joins a pull request at its head to
 */
export function boardJoin({
  deps,
  home,
}: {
  deps: {
    readonly boardBranches: (args: { home: string | undefined }) => ReadonlyMap<string, readonly LandingBoardRow[]>;
  };
  home: string | undefined;
}): (head: Pick<LandingRow, "headOid" | "number" | "repoSlug"> & { headRefName: string }) => LandingBoardRow {
  const board = deps.boardBranches({ home });
  return (head) => boardRowForHead({ head, rows: board.get(head.headRefName) });
}

/**
 * Whether the board already holds an ending for this pull request at THIS head — settled, closed or abandoned.
 *
 * Such a row is not work left to send anybody: `cmux spawn` refuses a settled ask, and `handover register`
 * refuses its slug as existing. A terminal row about an OLDER head does not count — the head moved, which is
 * new work — and nor does a terminal row naming no head at all. {@link aboutThisHead} says how a row names one.
 *
 * @param row the landing row, carrying its joined board row
 * @returns whether the board already holds this head's ending
 */
export function settledAtThisHead({ row }: { row: LandingRow }): boolean {
  return (
    row.boardRow.kind === "row" &&
    boardRowIsTerminal({ status: row.boardRow.status }) &&
    aboutThisHead({ head: row, row: row.boardRow })
  );
}

/**
 * Why the board already covers this pull request at this head, or undefined when a new row is wanted.
 *
 * Two rows hold it: a LIVE one, because somebody is on the branch, and one that already ENDED at this head. A
 * row that ended at an older head holds nothing — the head moved, so there is new work — and the status judged
 * is the derived one, so a settled ask whose own file still reads `status: ready` is terminal here. MEASURED:
 * one pull request went unseated for three passes behind a `... is ready` row that `cmux spawn` refused as
 * settled. The landing
 * register and `./bumpDriveActs.ts`'s seat both ask this, so the two cannot disagree about what a settled row
 * holds; the bump seat once read ANY declaring row as holding.
 *
 * @param row the landing row, carrying the board row its head joined to
 * @returns the sentence naming the row that holds it, or undefined
 */
export function boardHold({ row }: { row: LandingRow }): string | undefined {
  const live = liveBoardHold({ boardRow: row.boardRow });
  if (live !== undefined) {
    return live;
  }
  if (row.boardRow.kind !== "row") {
    return undefined;
  }
  if (settledAtThisHead({ row })) {
    return `${row.boardRow.slug} already ended at this head and is ${row.boardRow.status}`;
  }
  return undefined;
}

/** Why one row is not registered, or undefined when it should be. */
function skipReason({ row }: { row: LandingRow }): string | undefined {
  if (row.dispatch.kind !== "act") {
    return "it carries no dispatch verdict";
  }
  // `../../../review/landingDispatch.ts` already excludes this verdict from `dispatchable`, so this arm is
  // a second lock on the same door rather than a live path. It is here because the exported input type is
  // an unrestricted `LandingRow[]`: a future caller handing this function every row must not be able to
  // turn the one verdict that IS the owner's into a `--dispatch` row declaring nothing waits on them.
  if (row.dispatch.verdict === "needs-owner-judgment") {
    return "it is the one verdict that is the OWNER'S — a card, never a dispatch row declaring nobody waits on them";
  }
  if (row.dispatch.verdict === "merge-now") {
    return (
      "every test passed, so it is ENQUEUED rather than seated — a seat lane is not a thing this fleet has " +
      "(`github landing --press`, or `github enqueue`)"
    );
  }
  // A live row orphaned by a seat-closed park with no wake still holds the branch, so the act is that row's
  // RESEAT, never a second row over it (`../../../review/landingDispatchDraft.ts`); the fill does the reseat.
  if (row.boardRow.kind === "row" && boardRowNeedsReseat({ boardRow: row.boardRow })) {
    return (
      `${row.boardRow.slug} already holds this branch but is parked at rest with its seat closed and no wake — ` +
      `register no duplicate; reseat it with \`slopweaver cmux spawn ${row.boardRow.slug}\` during the fill`
    );
  }
  // `../landingReport.ts` already drops a row that ended at this head from `dispatchable`; its arm here is a
  // second lock for the same reason as the owner's-judgment arm above — the input type is unrestricted.
  return boardHold({ row });
}

/**
 * The rows `--register` writes, and the rows it deliberately passes over: every non-draft in fleet order, then
 * every draft in fleet order.
 *
 * Drafts go last because an `--include-drafts` read shares one {@link REGISTER_CAP} between them: in fleet order
 * a draft would take a slot a ready-to-work pull request wanted. Last, a draft only
 * ever takes a slot no non-draft wanted. And one pass files ONE row per branch: every skip is judged against the
 * board as read, before any write, so a second pull request on a branch this pass already plans is skipped
 * rather than seated beside the first. Pure, so what one tick would add to the board is
 * assertable without a filesystem.
 *
 * @param dispatchable the document's own dispatchable selection, which already excludes the owner's-judgment verdict
 * @returns one entry per considered row; `skipped` ones carry the sentence saying why
 */
export function plannedRegistrations({
  dispatchable,
}: {
  dispatchable: readonly LandingRow[];
}): readonly { readonly row: LandingRow; readonly skip: string | undefined }[] {
  const ordered = [
    ...dispatchable.filter((row) => row.action !== "draft"),
    ...dispatchable.filter((row) => row.action === "draft"),
  ];
  const planned = new Map<string, number>();
  return ordered.map((row) => {
    const skip = skipReason({ row });
    const branch = `${row.repoSlug.toLowerCase()}:${row.headRefName}`;
    const first = planned.get(branch);
    if (skip !== undefined) {
      return { row, skip };
    }
    if (first !== undefined) {
      return {
        row,
        skip: `#${String(first)} already plans a row on ${row.headRefName} this pass — one row per branch`,
      };
    }
    planned.set(branch, row.number);
    return { row, skip: undefined };
  });
}

/** The edges {@link performRegistrations} writes through. */
export interface LandingRegisterDeps {
  /** Writes one board row. Returns `handover register`'s own exit code; `quiet` keeps its receipt off stdout. */
  readonly registerRow: (args: { readonly argv: readonly string[]; readonly quiet: boolean }) => Promise<number>;
  /** The local checkout a row's repository is declared at, so a seated session has a tree to cut from. */
  readonly checkoutFor: (args: { readonly home: string | undefined; readonly repoSlug: string }) => string | undefined;
  /** The organisation the store holds (`../../../organisation/read.ts`), whose repositories place a row. */
  readonly readOrganisation: (args: {
    readonly home: string | undefined;
  }) => Promise<Result<Organisation, OrganisationError>>;
  readonly now: () => Date;
}

/** The organisation read on the first call and answered from that same read on every later one. */
function organisationOnce({
  deps,
  home,
}: {
  deps: LandingRegisterDeps;
  home: string | undefined;
}): () => Promise<Result<Organisation, OrganisationError>> {
  let read: Promise<Result<Organisation, OrganisationError>> | undefined;
  return () => {
    if (read !== undefined) {
      return read;
    }
    read = deps.readOrganisation({ home });
    return read;
  };
}

/**
 * Write one board row per registrable landing row, capped.
 *
 * The cap is enforced HERE rather than by the caller so a wider `--repo` can never turn one tick into a board
 * nobody can read. Its failure mode is benign — the next read, minutes later, registers the rest.
 *
 * @param dispatchable the document's dispatchable rows
 * @param dryRun describe every write and make none
 * @param home the state home the board lives under
 * @param quiet whether `handover register`'s receipt must stay off stdout, under `--json`
 * @param deps the injected write edges
 * @returns one outcome per row considered, in {@link plannedRegistrations}'s order
 */
export async function performRegistrations({
  dispatchable,
  dryRun,
  home,
  deps,
  quiet,
}: {
  dispatchable: readonly LandingRow[];
  dryRun: boolean;
  home: string | undefined;
  deps: LandingRegisterDeps;
  quiet: boolean;
}): Promise<readonly LandingRegistration[]> {
  const outcomes: LandingRegistration[] = [];
  let written = 0;
  // Read once, and only when a row is really written: the row states its workspace off the organisation's
  // repositories, and one that will not read fails each write with its own message rather than placing it by a guess.
  const readOnce = organisationOnce({ deps, home });
  for (const { row, skip } of plannedRegistrations({ dispatchable })) {
    const slug = registrationSlug({ row });
    const base = { number: row.number, repoSlug: row.repoSlug, slug, url: row.url };
    if (skip !== undefined) {
      outcomes.push({ ...base, detail: skip, outcome: "skipped" });
      continue;
    }
    if (written >= REGISTER_CAP) {
      outcomes.push({
        ...base,
        detail: `this invocation's cap of ${String(REGISTER_CAP)} board rows was already reached — the next read takes it`,
        outcome: "skipped",
      });
      continue;
    }
    written += 1;
    if (dryRun) {
      outcomes.push({ ...base, detail: registrationAsk({ row }), outcome: "would-register" });
      continue;
    }
    const organisation = await readOnce();
    if (organisation.isErr()) {
      outcomes.push({ ...base, detail: organisation.error.message, outcome: "failed" });
      continue;
    }
    outcomes.push(await registerOne({ base, deps, home, organisation: organisation.value, quiet, row }));
  }
  return outcomes;
}

/**
 * The exact argv one landing row is registered by — the whole command, as array elements.
 *
 * Exported and PURE because the defect this file records against itself was a producer/consumer mismatch
 * that a unit test asserting the same array could never catch: the argv was already pinned exactly, and it
 * was pinned WRONG, because the injected writer in that test returns a number rather than parsing anything.
 * A pure producer is what lets the subprocess lane run this exact array through the real `bin/slopweaver`.
 *
 * The slug is derived here rather than accepted, so no caller can hand in one that disagrees with the row.
 *
 * @param row the landing row being registered
 * @param askedIso the instant this read judged the row, which is a dispatch row's registration time rather
 *   than a moment the owner said anything
 * @param checkout the local tree a seated session cuts from, absent when none is declared for the repository
 * @param home the state home the board lives under, absent to take the ambient one
 * @param organisation the organisation whose repositories say whose work the pull request is
 * @returns the full argv, `node` and `slopweaver` included
 */
export function registrationArgv({
  row,
  askedIso,
  checkout,
  home,
  organisation,
}: {
  row: LandingRow;
  askedIso: string;
  checkout: string | undefined;
  home: string | undefined;
  organisation: Organisation;
}): readonly string[] {
  return [
    "node",
    "slopweaver",
    "handover",
    "register",
    "--ask",
    registrationAsk({ row }),
    "--dispatch",
    "--slug",
    registrationSlug({ row }),
    "--branch",
    row.headRefName,
    ...repositoryWorkspaceArgv({
      organisation,
      repository: row.repoSlug,
      what: "the landing dispatch's pull request",
    }),
    "--asked-iso",
    askedIso,
    ...(checkout === undefined ? [] : ["--repo", checkout]),
    ...(home === undefined ? [] : ["--home", home]),
  ];
}

/** One `handover register` call, plus the sentence its outcome carries. */
async function registerOne({
  row,
  base,
  deps,
  home,
  organisation,
  quiet,
}: {
  row: LandingRow;
  base: Omit<LandingRegistration, "detail" | "outcome">;
  deps: LandingRegisterDeps;
  home: string | undefined;
  organisation: Organisation;
  quiet: boolean;
}): Promise<LandingRegistration> {
  const checkout = deps.checkoutFor({ home, repoSlug: row.repoSlug });
  const code = await deps.registerRow({
    argv: registrationArgv({ askedIso: deps.now().toISOString(), checkout, home, organisation, row }),
    quiet,
  });
  if (code !== 0) {
    // The exit code, and nothing about what caused it. `handover register` writes the file BEFORE
    // `mirrorAfterWrite`, so a nonzero exit does not even establish that nothing was written — and the
    // sentence that used to stand here asserted a duplicate slug on every failure, which is how an ask-shape
    // refusal on EVERY row read as benign de-duplication for as long as it did.
    return {
      ...base,
      detail: `\`handover register\` exited ${String(code)} — its own lines are printed above and name the cause`,
      outcome: "failed",
    };
  }
  return {
    ...base,
    detail:
      checkout === undefined
        ? `registered at head ${row.headOid.slice(0, SLUG_HEAD_CHARS)}, with NO checkout declared for ${row.repoSlug} — a seated session has no tree to cut from`
        : `registered at head ${row.headOid.slice(0, SLUG_HEAD_CHARS)} against ${checkout}`,
    outcome: "registered",
  };
}
