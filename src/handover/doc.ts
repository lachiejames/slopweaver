/**
 * The orchestration-doc board: what each doc is, and which ones can be run right now.
 *
 * ## The friction this exists for
 *
 * Planning a hard piece of work is not the part that fails. Landing it is. A doc gets written, a dependency
 * means it cannot run yet, days pass, and the work is forgotten — or worse, run out of order. The owner's
 * words: *"sometimes I end up not executing an orchestration doc because I've forgotten about it, because I
 * had to wait for a different one first."*
 *
 * So the board answers one question — **what can I start right now?** — and states the rest as blocked, with
 * the reason. Everything else here serves that sentence.
 *
 * ## Metadata lives in the doc, never in an index
 *
 * The same argument that made the Codex pass ledger a scan rather than a file. A central index is a second
 * source of truth, and it desyncs the first time someone edits a doc in a text editor — which is the normal
 * way these get changed. The doc IS the record; this derives a view over the set.
 *
 * ## Declared status is a FALLBACK now, not the authority
 *
 * A doc that declares `doneWhen:` probes has its state computed from the repository (see {@link ./probe}), and
 * the declared `status:` stops being authoritative for it — that is the whole point, because a hand sweep
 * found a large minority of statuses simply wrong. A doc with no probes keeps its declared status,
 * because retro-fitting probes to every existing doc is deliberately out of scope: removing the field
 * wholesale would blank the board instead of correcting it.
 *
 * ## TWO readers over one front-matter, and why that is not a mistake
 *
 * `doneWhen:` is a list of maps, which is nesting, and this file's previous comment said to take a YAML
 * dependency when that day came rather than grow a parser here. That day came — but it came only for
 * `doneWhen:`.
 *
 * Handing the WHOLE front-matter to a strict YAML parser was tried first and regressed three live docs: a
 * `summary:` beginning with a backtick is a reserved character in a plain scalar, and one containing `: ` reads
 * as a nested mapping. Those docs had parsed for weeks and were runnable; strict YAML made them malformed. The
 * unit suite was green throughout — only running the board against the real directory showed it.
 *
 * So the flat scalars keep the original hand reader (`./docFlat.ts`), which never needed nesting, and YAML
 * reads only the nested block (`./docNested.ts`). They are two modules rather than two functions here so
 * that neither can reach the other's state, which is how the independence below is HELD instead of
 * remembered. A YAML failure is reported ONLY when `doneWhen:` is
 * actually declared, so a doc with no stake in the parse cannot be condemned by it.
 *
 * The independence has to run BOTH ways, and the first attempt only ran one way. YAML was handed the whole
 * front-matter, so a malformed *flat* scalar still broke the *nested* read: adding probes to
 * `distil-latest-collapse` — whose summary opens with a backtick — made them silently unloadable and the doc
 * malformed. `nestedBlock` therefore lifts out just the `doneWhen:`/`outputs:` lines, so neither reader can
 * take the other down.
 *
 * The trap inside the YAML half, measured rather than reasoned: values are read with `get(key)`, NEVER
 * `toJS()`. Given a duplicated key, `get` returns the FIRST value while `toJS` returns the last — so `toJS`
 * would silently reintroduce the precise defect this file was hardened against, where a blank `blockedBy:`
 * following a real one erased the dependency and the doc printed under RUN NOW.
 *
 * Pure: the caller supplies already-read text. No filesystem, no clock.
 */

import { templateField } from "../cmux/launchTemplate.js";
import { isSessionRole, type SessionRole } from "../cmux/role.js";
import type { AskOption } from "./askShape.js";
import { duplicateKeyProblem, flatArtifact, flatFields } from "./docFlat.js";
import { type DocExamples, type DocShot, docExamples, docShot, nestedFields } from "./docNested.js";
import { oneLineList, oneLineProblems, oneLineValue, summaryValue } from "./docOneLine.js";
import { docProblems } from "./docProblems.js";
import { type DocSettlement, type DocTrunkRecheck, docSettlementFields } from "./docSettlement.js";
import { type HisWordsOnRow, hisWordsOnRow } from "./hisWordsSteers.js";
import { pausedStateOf } from "./paused.js";
import type { ComputedState, Probe, ProbeResult } from "./probe.js";
import {
  asBoardPriority,
  asRowKind,
  asRowOrigin,
  type BoardPriority,
  type BoardRowKind,
  type RowOrigin,
} from "./rowKind.js";
import { withRowProblems } from "./rowProblems.js";
import { type Workspace, workspaceField } from "./workspace.js";

/** The one `priorityFrom:` value there is: the `priority:` beside it is the kind default a backfill wrote down. */
export const PRIORITY_FROM_DEFAULT = "default";

/**
 * What evaluating one doc's probes concluded, handed to {@link blockerFor} so it stays pure.
 *
 * Optional throughout: a caller with no filesystem (or `handover check`, which is about how a doc is written)
 * passes nothing and gets exactly the previous declared-status behaviour.
 */
export interface DocProbeState {
  readonly results: readonly ProbeResult[];
  readonly computed: ComputedState | undefined;
  /** Commits on the doc's branch or worktree that are not on the base — what separates in-flight from untouched. */
  readonly commitsAhead: number;
}

/**
 * How many checkable conditions a doc declares.
 *
 * ONLY `doneWhen:` counts. `outputs:` deliberately does not: it is provenance, not a condition — see
 * {@link outputProbes} for the measured reason, which is that an output naming an already-existing file made a
 * doc compute `landed` the moment it was written.
 *
 * The consequence is honest rather than convenient: a doc whose deliverable is pure judgement has NO mechanical
 * done-signal, and the board says so instead of inventing one. An author who wants one names a file that does
 * not exist yet, in `doneWhen`.
 *
 * @param doc the doc to count
 * @returns how many conditions the repository can be asked about
 */
export function declaredConditions({ doc }: { doc: HandoverDoc }): number {
  return doc.doneWhen.length;
}

/** Whether probes actually produced a verdict for this doc, so a missing `status:` need not condemn it. */
function probesAnswered({ doc, state }: { doc: HandoverDoc; state: DocProbeState | undefined }): boolean {
  return declaredConditions({ doc }) > 0 && state?.computed !== undefined;
}

/**
 * How far along a doc DECLARED it is.
 *
 * Retained, and still the authority for a doc with no probes — `docs/constraints/coupled-claims.md` names this union as such.
 * `blocked` is deliberately absent, because blocking is derived from `blockedBy`.
 *
 * `cancelled` and `rejected` are Linear-style terminal-but-not-shipped states: the work will not be pursued
 * (`cancelled`) or was explicitly not accepted (`rejected`), as distinct from `done`. Both require a
 * `statusSummary:` reason and both win over probe evidence in the board's precedence — see
 * `src/handover/boardEvidence.ts`.
 *
 * `paused` is the one NON-terminal state a row declares about the world rather than about itself: the work
 * is useful, nobody has given up on it, and it waits on a person. It carries {@link HandoverDoc.pausedOn}
 * and no clock at all — see `src/handover/paused.ts` for the ruling and for why it is a status when
 * `blocked` was refused as one.
 */
export type DocStatus = "draft" | "ready" | "in-progress" | "paused" | "done" | "cancelled" | "rejected" | "unknown";

/** `DocStatus` minus the `unknown` parser sentinel — every status a doc can legitimately declare. */
export type KnownDocStatus = Exclude<DocStatus, "unknown">;

/** The terminal statuses: work that will not continue, shipped or not. */
export type TerminalDocStatus = "done" | "cancelled" | "rejected";

/** Terminal statuses that are NOT `done` — closed, but the work did not ship. */
export type ClosedNotShippedStatus = "cancelled" | "rejected";

/**
 * Whether a status is terminal — `done`, `cancelled`, or `rejected`.
 *
 * A type predicate is the one signature this repository's named-object-params rule cannot apply to (TS1230
 * forbids destructuring an `x is T` parameter), so this is the compiler's own exemption, not an oversight.
 *
 * @param status the status to test
 * @returns whether it is one of the three terminal statuses
 */
export function isTerminalDocStatus(status: DocStatus): status is TerminalDocStatus {
  return status === "done" || status === "cancelled" || status === "rejected";
}

/**
 * Every status a doc may declare. `unknown` is what an unparseable or absent value becomes.
 *
 * `blocked` is deliberately NOT one of them. Whether a doc is blocked is derived from `blockedBy` and the
 * state of what it names, so declaring it too would be a second source of truth — and the first time the two
 * disagreed, nobody would know which was right. Found by dogfooding: the first three real docs written for
 * this feature all said `status: blocked`, and the board correctly refused to understand it.
 *
 * `paused` is NOT a re-admission of `blocked` under another name, and the test that separates them is
 * whether anything else already carries the fact. Nothing does: `blockedBy:` resolves slugs, a person is not
 * a slug, and no field on any doc says who a row is waiting on. So a pause has exactly one source, which is
 * the property `blocked` failed. `./paused.ts` holds the argument in full.
 */
export const KNOWN_STATUSES: readonly KnownDocStatus[] = [
  "draft",
  "ready",
  "in-progress",
  "paused",
  "done",
  "cancelled",
  "rejected",
];

/**
 * One orchestration doc, as its front-matter declares it — the owner's words at its `anchor:` and every further steer of theirs
 * included ({@link HisWordsOnRow}).
 */
export interface HandoverDoc extends DocExamples, DocSettlement, DocShot, DocTrunkRecheck, HisWordsOnRow {
  /** The stable identifier other docs reference in `blockedBy`. Falls back to the filename. */
  readonly slug: string;

  /**
   * `kind:` — what this row IS, so one board can hold planned work and the things the owner asked for.
   *
   * `doc` when absent, which is why no existing doc needed touching when asks arrived. See
   * {@link ./rowKind.ts} for why a Slack tag is a row of this board without ever being a file in it.
   */
  readonly kind: BoardRowKind;
  /**
   * `priority:` — the band this row ranks in, when its author or a reprioritisation pass named one.
   *
   * `undefined` means the row's KIND decides, which is where "a tag generally outranks doc work" lives.
   * Kept as the declared value rather than resolved here so a reader can tell a deliberate `p2` from a doc
   * that simply never said.
   */
  readonly priority: BoardPriority | undefined;
  /**
   * `priorityFrom: default` — the {@link HandoverDoc.priority} above is the row's KIND default written down by
   * `handover set-priority --backfill`, not a band anybody chose. Present only then: the value ranks exactly as an
   * undeclared one would, and `./rank.ts` keeps such a row ungroomed so the backfill never claims a judgement.
   */
  readonly priorityFrom?: "default";
  /**
   * `askedIso:` — when the owner actually said it, for a row that registers an ask.
   *
   * This is the field the whole register turns on. An ask's cost is the LATENCY between the owner saying a
   * thing and anything existing for it, and that number is uncomputable unless the moment they said it is
   * written down. Measured: thirteen hours and one minute between a first stuck-chat ask and the first
   * doc that registered it, recoverable only by reading the owner's transcripts afterwards.
   */
  readonly askedIso: string | undefined;
  /**
   * `anchor:` — where the owner said it: a Slack permalink, a transcript pointer, a message reference.
   *
   * Attributable, never authenticated (`.claude/rules/cross-session-messages.md`). Its job is that a reader
   * can go and read the original words rather than trusting this row's paraphrase of them.
   */
  readonly anchor: string | undefined;
  /**
   * `bearsOn:` — one line saying how {@link hisWords} bear on the question, written by the registering session.
   *
   * The Queue card draws it after the owner's words, as why the card is in front of them. It is the
   * session's framing, never the owner's.
   */
  readonly bearsOn?: string | undefined;
  /**
   * `origin:` — `finding` when a SESSION registered this ask from something it observed, rather than the owner.
   *
   * Absent for the owner's own asks ({@link ./rowKind.ts}): a finding row still ranks and reads as an ask, but it carries where it came from,
   * and the team-facing doors refuse its outward action until {@link ruling} is recorded.
   */
  readonly origin: RowOrigin | undefined;
  /** `observedBy:` — the session that registered a `finding` row, so its origin is a checkable id. */
  readonly observedBy: string | undefined;
  /** `registeredBy:` — the session `handover register` ran in, on any row it wrote (`./registerProvenance.ts`). */
  readonly registeredBy: string | undefined;
  /** `registeredRun:` — the run that session held when it registered the row, when one was established. */
  readonly registeredRun: string | undefined;
  /** `evidence:` — what a `finding` row was registered FROM: the PRs, threads or logs a session observed. */
  readonly evidence: readonly string[];
  /**
   * `problem:` — one line saying what is actually wrong or undecided, on an ask row.
   *
   * The first third of the SHAPE required of an ask that waits on the owner's word:
   * a recorded ask the owner has to parse is a defect. `./askShape.ts` holds the caps and the refusal; the three
   * fields are whole or absent together, which `askRowProblems` enforces.
   */
  readonly problem: string | undefined;
  /** `options:` — the two to four things the owner could decide, each with its trade-off. Empty when none was written. */
  readonly options: readonly AskOption[];
  /**
   * `lean:` — what the SESSION recommends the owner would most likely pick with infinite time and attention.
   *
   * Written in the owner's voice, which is a register and never a claim about who spoke. A surface rendering this
   * attributes it to the session; `./askShape.ts`'s header says why, and {@link HandoverDoc.ruling} is the
   * field that carries what the owner actually said.
   */
  readonly lean: string | undefined;
  /**
   * `risk:`, `blastRadius:` and `stillReal:` — the STAKES of an ask row (`./askShape.ts`'s `AskStakes`).
   * Whole or absent together; absent on an older-shaped row, which is not a defect.
   */
  readonly risk: string | undefined;
  readonly blastRadius: string | undefined;
  readonly stillReal: string | undefined;
  /**
   * `stillRealIso:` — when `handover register` recorded the still-real check, off its own clock. Never
   * typed by a caller: an age a caller can type is an age that can lie.
   */
  readonly stillRealIso: string | undefined;
  /** `ruling:` — the owner's own words on a `finding` row, once the owner has seen it and said what may reach the team. */
  readonly ruling: string | undefined;
  /** `rulingAnchor:` — where the owner gave that ruling. Attributable, never authenticated, like {@link anchor}. */
  readonly rulingAnchor: string | undefined;
  /** One line saying what the work is. `undefined` when the doc did not state one. */
  readonly summary: string | undefined;
  readonly status: DocStatus;
  /**
   * `pausedOn:` — WHO this row is waiting on, required by and only meaningful with `status: paused`.
   *
   * Free text in the words of whoever paused it, never a slug and never resolved against anything: the
   * subject of a pause is a person, a team or an outside party, and forcing it through `blockedBy:` is what
   * made the board print *"which no doc on the board claims"* about a human being. See {@link ./paused.ts}.
   */
  readonly pausedOn: string | undefined;
  /**
   * `pausedSince:` — the date the pause was recorded, when whoever paused it knew one.
   *
   * PROVENANCE ONLY. Nothing subtracts from it, nothing ranks by it, and there is no `pausedUntil:` for it
   * to count towards, because a pause carries no time limit and no deadline. It is here so the board can
   * say since when, which is the half of "we should still remember it" a bare `pausedOn:` loses.
   */
  readonly pausedSince: string | undefined;
  /** Slugs that must be `done` first. Empty for an unblocked doc. */
  readonly blockedBy: readonly string[];
  /** The repository the work targets, so the board can say where to run it. */
  readonly repo: string | undefined;

  /**
   * `supervisorState:` — the path of the state doc a supervisor handoff boots from.
   *
   * Its PRESENCE is what makes a doc a supervisor doc, which is the only thing this repo needs to know: the
   * path itself is the owner's own layer, never named here (`docs/constraints/partition.md`'s partition). Declaring it
   * puts the doc's `handover start` behind the state doc's size caps
   * ({@link ../supervisor/stateDoc.ts}), so a successor cannot open a shift on a doc that has already grown
   * past what anyone reads.
   */
  readonly supervisorState: string | undefined;

  /**
   * `role:` — what KIND of session this doc's spawn is, so its sidebar row wears the right colour.
   *
   * Optional, and expected to be absent on nearly every doc. The row's role is normally read off the
   * repository the doc names, which is right for most of the live board; this line exists for the doc that
   * lives in one repository while its AUDIENCE is another — a team-facing workstream carried out in this
   * checkout. See `src/cmux/role.ts` for the tiers and the colours.
   */
  readonly role: SessionRole | undefined;

  /**
   * `template:` — which launch template this doc's seat boots from (`src/cmux/launchTemplate.ts`), as declared.
   * Optional: absent, the seat takes its role's default. Unlike a mistyped `role:`, which only mis-colours a row,
   * an unknown name is a front-matter PROBLEM, and `cmux spawn` refuses it, because it decides what the seat loads.
   */
  readonly template?: string;
  /**
   * `workspace:` — whose work this row is, `team` or `self`, as its writer stated it (`./workspace.ts`).
   * Never read off {@link HandoverDoc.repo}, which is only where the session runs. Absent when the doc states none.
   */
  readonly workspace?: Workspace;
  /** A `workspace:` line naming no workspace, as written — a doc problem the board still publishes the row beside. */
  readonly workspaceUnread?: string;
  /** The alias spelling a `workspace:` line carries, beside the workspace it reads as — `set-workspace` rewrites it. */
  readonly workspaceAlias?: string;
  /**
   * The branch this doc's work lives on, when the author knows it.
   *
   * Added because inference measurably failed. The board guessed a branch from two exact candidates — the slug
   * and `worktree-<slug>` — and a review of the live board found a real 14-commit worktree it MISSED, because
   * the branch was `v2-atlas-rebuild` while the slug was `v2-datadog-atlas-rebuild`. The doc read as untouched
   * while a fortnight of work sat on disk, which is precisely the failure this whole feature exists to end.
   *
   * Widening the guess was the wrong fix: name similarity is exactly the fuzzy matching this repo forbids, and
   * a frequently-wrong `in-flight` is worse than none. So the author declares it, the same way they declare
   * `doneWhen:` — and `handover start --branch` records it in the ledger, which is exact either way.
   */
  readonly branch: string | undefined;
  /**
   * The branch a brand-new {@link branch} should FORK FROM, when it is not trunk.
   *
   * A different question from {@link branch}: that field names which branch the doc's work lives ON, this one
   * names what a worktree that does not exist yet is created FROM. `cmux spawn`'s `createWorktree` otherwise
   * always resolves the remote's own default branch (`staging` for a repo whose trunk is not `main`) — correct
   * for the common case, but wrong for a doc scoped to content that only exists on a different long-lived
   * branch (e.g. a repo's own documented exception branch). Declared, never inferred from the doc's file
   * references — that is the same fuzzy-matching {@link branch}'s own guess-from-slug already failed at, one
   * layer earlier. `undefined` leaves `createWorktree`'s existing trunk-resolution path byte-for-byte unchanged.
   */
  readonly baseBranch: string | undefined;
  /**
   * The Claude artifact that explains the work in prose.
   *
   * Recorded because the owner reads the artifact, not the doc, when picking work up days later. Kept as a
   * first-class field rather than buried in the body so the board can show that it is MISSING.
   */
  readonly artifact: string | undefined;
  /**
   * Present when the `artifact:` line is the bare, UNQUOTED `null` that `ensureArtifactDefault` writes — "none
   * yet", not a value. `artifact` still reads `"null"` so that writer sees the key declared; a quoted `"null"`
   * is an authored string and never sets this.
   */
  readonly artifactIsPlaceholder?: true;
  /**
   * The observable consequences of this doc's work having landed, which the repository can be asked about.
   *
   * Empty for a doc that declares none, and that is not a defect — it means the doc's state cannot be
   * computed and its declared `status:` still stands. What it is NOT is a licence to assume anything: the
   * board says "no probes" rather than showing a computed-looking word next to work nothing examined.
   */
  readonly doneWhen: readonly Probe[];
  /**
   * Where a doc whose deliverable is JUDGEMENT rather than code puts its result — an artifact URL, a doc
   * path, a memory slug.
   *
   * Investigation and decision docs produce no symbol any probe could reach, so no oracle over the source
   * tree could ever tell whether they are done. Declaring the landing site turns that into a question with an
   * answer: does the output exist yet? It is also where a paused run records what it was waiting to learn.
   */
  readonly outputs: readonly string[];
  /**
   * The stated reason `doneWhen:` is narrower than what "done" actually means for this doc, when the author
   * gave one.
   *
   * A probe proves a symptom absent, which the module header on `../devLint/registerHygiene.js` calls weaker
   * than the scope having shipped — so a doc whose probes are a deliberately narrow slice of a larger promise
   * can pass every one of them while genuinely not being finished. Without this field the board and the
   * register-hygiene gate have no way to tell that case apart from an abandoned doc nobody flipped to `done`,
   * and nag both identically. Declaring the gap explains it instead: `undefined` still means the two states
   * are believed to coincide, which is what makes this safe to leave off every doc that has no such gap.
   */
  readonly notDoneReason: string | undefined;
  /**
   * Why this doc may be set `done` with no BEHAVIOURAL probe — the recorded escape from the rule in
   * `./behaviouralProbe.ts`.
   *
   * The gate fails loudly by default, with an escape hatch. A hard refuse is
   * heavy-handed with diminishing returns, because proving that a complaint will not be raised twice is
   * often genuinely infeasible — the work landed in a repository this checkout cannot see, or the seam has
   * no test lane yet. So the gate refuses by default and this field is what gets past it.
   *
   * The point of putting it HERE rather than in an environment variable is that a waiver must not be
   * silent: it lives on the doc, it says why in the author's own words, and every surface that applies the
   * rule prints it instead of passing over the doc without comment. An unsanctioned `done` stays visible on
   * the board, which is the whole difference between an escape hatch and a hole.
   *
   * Distinct from {@link notDoneReason}, which explains the opposite gap — probes narrower than the scope on
   * a doc that is NOT done.
   */
  readonly probeWaiver: string | undefined;
  /**
   * Why this doc's CURRENT status is credible — not what the work is, but what makes an agent confident in
   * its present state before executing it: what's blocked and on what, what human input is still needed,
   * what can proceed independently, or (for a terminal status) why the work stopped and what supersedes it.
   *
   * Distinct from {@link summary} (stable "what is this work") and from {@link notDoneReason} (the narrow
   * "probes are a smaller slice than the scope" explanation). `undefined` on an untouched legacy doc is not
   * itself a defect — enforcement is prospective, not a backfill; see `src/handover/statusSummary.ts`.
   */
  readonly statusSummary: string | undefined;
  /** The absolute path to the doc. */
  readonly path: string;
  /**
   * Defects found while reading the front-matter, each one a sentence.
   *
   * A doc with any problem is NOT runnable. Parsing is where a doc can quietly become a different doc — a
   * repeated key silently overwrote a real `blockedBy` with a blank one, which made a dependent print under
   * RUN NOW while its prerequisite was unfinished. Found by a review pass. Carrying the problem on the doc,
   * rather than throwing, keeps the board renderable: one malformed doc must not blank the whole queue.
   */
  readonly problems: readonly string[];
}

/** The slug a doc declared, else its filename without the extension. */
function docSlug({ declared, path }: { declared: string | undefined; path: string }): string {
  if (declared !== undefined) {
    return declared;
  }
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
}

/** Why a doc cannot be started yet, or `undefined` when it can. */
export type Blocker =
  | { readonly kind: "waiting"; readonly on: readonly string[] }
  | { readonly kind: "missing-dependency"; readonly on: readonly string[] }
  | { readonly kind: "already-done" }
  | { readonly kind: "still-draft" }
  /** The doc declared no `status:`, or one this tool does not recognise. */
  | { readonly kind: "undeclared-status" }
  /** More than one doc claims this slug, so nothing about it can be resolved. */
  | { readonly kind: "duplicate-slug"; readonly paths: readonly string[] }
  /** The front-matter itself did not read cleanly, so nothing it declares can be trusted. */
  | { readonly kind: "malformed"; readonly problems: readonly string[] }
  /** A dependency slug is claimed by more than one doc, so "is it done?" has no single answer. */
  | { readonly kind: "ambiguous-dependency"; readonly on: readonly string[] }
  /**
   * Every probe the doc declares already passes, so the work it describes appears to have landed.
   *
   * NOT `already-done`, and the distinction is the whole design. Probes prove a symptom is absent, which is
   * weaker than the scope having shipped, so this refuses to START the doc and asks for a human confirmation
   * rather than marking it done itself. This is the blocker that kills the shipped-but-still-`ready` class.
   */
  | { readonly kind: "probes-pass"; readonly count: number }
  /** Commits exist for this doc on a branch or worktree, but nothing it promised is observable yet. */
  | { readonly kind: "in-flight"; readonly commitsAhead: number }
  /** Some probes pass and some fail — the state a boolean cannot hold, and the one that needs a follow-up. */
  | { readonly kind: "partial"; readonly passed: number; readonly failed: number }
  /**
   * Every probe that WAS checked passes; the rest were never evaluated (a declined `command:` probe, or a
   * file nothing could read). Distinct from `partial`: nothing here has actually failed, so this is
   * informational rather than a reason to stop — `--probe` is what would settle it.
   */
  | { readonly kind: "unevaluated"; readonly passed: number; readonly skipped: number }
  /**
   * The row is paused on a person, so nothing about it is startable until somebody decides to unpause it.
   *
   * NOT `waiting`, and the distinction matters to every reader: `waiting` names other DOCS that have to land
   * first and clears itself when they do, while this clears only when a human says so. Carried here as well
   * as in `boardState.ts` so the PURE path cannot report a paused row as runnable either.
   */
  | { readonly kind: "paused"; readonly on: string }
  /**
   * The doc declared `in-progress` and offers no probes to check that against.
   *
   * Previously such a doc had no blocker at all, so it printed under `RUN NOW — n ready` beside genuinely
   * untouched work. It is not a defect worth patching separately; it is the same defect as every other
   * undeclared truth on this board, and it is stated here rather than guessed at.
   */
  | { readonly kind: "declared-in-progress" };

/**
 * Split YAML-ish front-matter from the body.
 *
 * A line split, not a parse. The flat scalars are still read from these lines by hand ({@link flatFields}),
 * because they are a fixed set of scalars and never needed nesting. The nesting that DID arrive — `doneWhen:` —
 * took the `yaml` dependency, as this file's earlier comment said it should, but only for that block: see
 * {@link nestedBlock}.
 *
 * @param text the whole file
 * @returns the front-matter lines, empty when the file has none
 */
export function frontMatterLines({ text }: { text: string }): readonly string[] {
  const block = frontMatterBlock({ text });
  return block === undefined ? [] : block.split("\n");
}

/** The raw front-matter text between the fences, or `undefined` when there is none to read. */
function frontMatterBlock({ text }: { text: string }): string | undefined {
  const fence = frontMatterFence({ text });
  return fence === undefined ? undefined : fence.normalised.slice(4, fence.closeIndex);
}

/**
 * Where a doc's front-matter fences sit in its (CRLF-normalised) text, for a caller that needs to splice
 * something into the block rather than just read it — see {@link ../frontmatter.ts}'s artifact default.
 *
 * @param text the whole file
 * @returns the normalised text and the index of the closing `\n---`, or `undefined` when there is no closed
 *   front-matter block to splice into
 */
export function frontMatterFence({ text }: { text: string }): { normalised: string; closeIndex: number } | undefined {
  const normalised = text.replace(/\r\n/g, "\n");
  if (!normalised.startsWith("---\n")) {
    return undefined;
  }
  const closeIndex = normalised.indexOf("\n---", 3);
  return closeIndex === -1 ? undefined : { closeIndex, normalised };
}

/** A declared status, or `unknown` — never a guess, and an absent field is not a default. */
function asStatus({ value }: { value: string | undefined }): DocStatus {
  const status = KNOWN_STATUSES.find((known) => known === value);
  if (status === undefined) {
    return "unknown";
  }
  return status;
}

/**
 * Read the optional `role:` line, discarding anything that is not a real role.
 *
 * A typo becomes an absence rather than a problem, deliberately: this field only decides a row's colour, and
 * refusing to parse a runnable doc over a decoration is exactly the trade `spawn.ts` already makes when the
 * colour itself fails to publish.
 */
function asSessionRole({ value }: { value: string | undefined }): SessionRole | undefined {
  return isSessionRole(value) ? value : undefined;
}

/**
 * Read one doc's front-matter.
 *
 * A missing or malformed field becomes an explicit absence rather than a default that reads as a claim:
 * `status: unknown` says "this doc did not say", which is different from `draft`.
 *
 * @param text the whole file
 * @param path the absolute path, used as the fallback slug and reported by the board
 * @returns the parsed doc
 */
export function parseHandoverDoc({ text, path }: { text: string; path: string }): HandoverDoc {
  const lines = frontMatterLines({ text });
  const flat = flatFields({ lines });
  const nested = nestedFields({ lines });
  // Every field but `summary` is held to one line, because its readers print rows (`./docOneLine.ts`).
  const named = ({ key }: { key: string }): string | undefined => oneLineValue({ fields: flat.fields, key });
  const doc: HandoverDoc = {
    anchor: named({ key: "anchor" }),
    ...flatArtifact({ fields: flat.fields, lines }),
    askedIso: named({ key: "askedIso" }),
    baseBranch: named({ key: "baseBranch" }),
    bearsOn: named({ key: "bearsOn" }),
    blastRadius: named({ key: "blastRadius" }),
    blockedBy: oneLineList({ fields: flat.fields, key: "blockedBy" }),
    branch: named({ key: "branch" }),
    doneWhen: nested.probes,
    evidence: oneLineList({ fields: flat.fields, key: "evidence" }),
    ...docExamples({ examples: nested.examples, gap: named({ key: "exampleGap" }) }),
    ...hisWordsOnRow({ anchor: named({ key: "anchor" }), duplicated: flat.duplicated, fields: flat.fields }),
    kind: asRowKind({ value: named({ key: "kind" }) }),
    lean: named({ key: "lean" }),
    notDoneReason: named({ key: "notDoneReason" }),
    observedBy: named({ key: "observedBy" }),
    options: nested.options,
    origin: asRowOrigin({ value: named({ key: "origin" }) }),
    outputs: nested.outputs,
    path,
    pausedOn: named({ key: "pausedOn" }),
    pausedSince: named({ key: "pausedSince" }),
    priority: asBoardPriority({ value: named({ key: "priority" }) }),
    ...(named({ key: "priorityFrom" }) === PRIORITY_FROM_DEFAULT ? { priorityFrom: PRIORITY_FROM_DEFAULT } : {}),
    probeWaiver: named({ key: "probeWaiver" }),
    problem: named({ key: "problem" }),
    problems: oneLineProblems({ problems: docProblems({ flat, named, nested: nested.problems }) }),
    registeredBy: named({ key: "registeredBy" }),
    registeredRun: named({ key: "registeredRun" }),
    repo: named({ key: "repo" }),
    risk: named({ key: "risk" }),
    role: asSessionRole({ value: named({ key: "role" }) }),
    ruling: named({ key: "ruling" }),
    rulingAnchor: named({ key: "rulingAnchor" }),
    ...docSettlementFields({ named }),
    ...docShot({ shot: nested.shot }),
    slug: docSlug({ declared: named({ key: "slug" }), path }),
    status: asStatus({ value: named({ key: "status" }) }),
    statusSummary: named({ key: "statusSummary" }),
    stillReal: named({ key: "stillReal" }),
    stillRealIso: named({ key: "stillRealIso" }),
    summary: summaryValue({ fields: flat.fields }),
    supervisorState: named({ key: "supervisorState" }),
    ...templateField({ declared: named({ key: "template" }) }),
    ...workspaceField({
      declared: named({ key: "workspace" }),
      twice: flat.problems.includes(duplicateKeyProblem({ key: "workspace" })),
    }),
  };
  return withRowProblems({ doc, named });
}

/**
 * Why a doc cannot be started, or `undefined` when it can.
 *
 * A dependency naming a slug that does not exist is its OWN blocker, distinct from waiting on a real one.
 * Silently treating an unknown slug as satisfied would let a typo mark work runnable — which is the failure
 * mode this whole board exists to prevent, reintroduced one level down.
 *
 * @param doc the doc under consideration
 * @param all every doc on the board
 * @param state the doc's evaluated probes, when the caller has a repository to ask; omitted by a pure caller,
 *   which yields exactly the declared-status behaviour this had before probes existed
 * @returns the blocker, or `undefined` when the doc is runnable now
 */
export function blockerFor({
  doc,
  all,
  state,
}: {
  doc: HandoverDoc;
  all: readonly HandoverDoc[];
  state?: DocProbeState;
}): Blocker | undefined {
  const declared = declaredBlocker({ all, doc });
  if (declared !== undefined) {
    return declared;
  }
  const computed = computedBlocker({ doc, state });
  if (computed !== undefined) {
    return computed;
  }
  return undeclaredOrWaiting({ all, doc, state });
}

/**
 * What the doc's own state and evaluated probes say, before any dependency is considered.
 *
 * Ordered ahead of `blockedBy` deliberately: if a doc's probes already pass, telling the reader it is "waiting
 * on x" is both wrong and wasteful — the useful fact is that the work appears to exist already.
 */
function computedBlocker({ doc, state }: { doc: HandoverDoc; state: DocProbeState | undefined }): Blocker | undefined {
  if (state === undefined || declaredConditions({ doc }) === 0) {
    // No probes to reason from, so the declared word is all there is. An `in-progress` doc is separated out
    // rather than shown as ready, because it is not untouched work.
    return doc.status === "in-progress" ? { kind: "declared-in-progress" } : undefined;
  }
  const passed = state.results.filter((result) => result.outcome === "pass").length;
  const failed = state.results.filter((result) => result.outcome === "fail").length;
  if (state.computed === "landed") {
    // A stated `notDoneReason` means the author already told us these probes are a narrower slice than the
    // doc's real scope — so falling through to the declared status/dependency checks below is correct, not a
    // missed case: this doc is exactly as runnable as its `status:` says, same as one with no probes at all.
    return doc.notDoneReason === undefined ? { count: passed, kind: "probes-pass" } : undefined;
  }
  if (state.computed === "partial") {
    return { failed, kind: "partial", passed };
  }
  if (state.computed === "unevaluated") {
    const skipped = state.results.filter((result) => result.outcome === "not-evaluated").length;
    return { kind: "unevaluated", passed, skipped };
  }
  if (state.computed === "in-flight") {
    return { commitsAhead: state.commitsAhead, kind: "in-flight" };
  }
  // `not-started`, or not computable at all: fall through so the declared status and dependencies decide.
  return state.computed === undefined && doc.status === "in-progress" ? { kind: "declared-in-progress" } : undefined;
}

/** The original body, minus the parts hoisted above. */
function declaredBlocker({ doc, all }: { doc: HandoverDoc; all: readonly HandoverDoc[] }): Blocker | undefined {
  // Duplicates are REPORTED, never resolved. `new Map(all.map(...))` silently keeps the last entry, so
  // filename order would decide whether a dependency counted as done — found by a review pass, which built
  // exactly that fixture. Two docs claiming one slug is a data error the owner has to see, and quietly
  // picking a winner is the overclaim this board exists to remove.
  const sharing = all.filter((other) => other.slug === doc.slug);
  if (sharing.length > 1) {
    return { kind: "duplicate-slug", paths: sharing.map((other) => other.path) };
  }
  // A doc that did not parse cleanly is refused before anything it CLAIMS is considered — its status and
  // its dependencies are exactly the fields a parse defect corrupts.
  if (doc.problems.length > 0) {
    return { kind: "malformed", problems: doc.problems };
  }
  // Checked BEFORE any status, because a duplicate outranks one: a `done` doc that shares its slug would
  // otherwise report "done" and hide the collision that makes every dependent unresolvable.
  //
  // TEMPORARY, stage-1 safety net for the board-status/lifecycle redesign: `cancelled`/`rejected` are folded
  // into the same non-startable branch as `done` so no intermediate commit between here and the real
  // `boardState.ts` precedence engine can ever expose a terminal-not-shipped doc as runnable. This block is
  // removed once callers migrate to `boardRefusal.ts`'s `executionRefusal`.
  if (isTerminalDocStatus(doc.status)) {
    return { kind: "already-done" };
  }
  // Ahead of the draft check and ahead of every probe rule below, because a pause is a statement about the
  // world rather than about how far the work got: a paused row's probe arithmetic is not the useful fact,
  // who it waits on is.
  const paused = pausedStateOf({ doc });
  if (paused !== undefined) {
    return { kind: "paused", on: paused.who };
  }
  return doc.status === "draft" ? { kind: "still-draft" } : undefined;
}

/**
 * The declared-status floor and the dependency graph — everything that only applies once probes have had
 * their say.
 *
 * A doc with PASSING probes never reaches here, which is why an unreadable `status:` no longer condemns a doc
 * whose repository can speak for it.
 */
function undeclaredOrWaiting({
  doc,
  all,
  state,
}: {
  doc: HandoverDoc;
  all: readonly HandoverDoc[];
  state: DocProbeState | undefined;
}): Blocker | undefined {
  // A doc that declared no status, or an unrecognised one, is NOT runnable — unless its probes answered the
  // question instead, which is exactly the case this whole change adds. Falling through with neither would
  // let a typo — or `status: blocked`, which is not a status — mark work as startable.
  if (doc.status === "unknown" && !probesAnswered({ doc, state })) {
    return { kind: "undeclared-status" };
  }
  const counts = new Map<string, readonly HandoverDoc[]>();
  for (const slug of new Set(doc.blockedBy)) {
    counts.set(
      slug,
      all.filter((other) => other.slug === slug),
    );
  }
  const missing = [...counts].filter(([, matches]) => matches.length === 0).map(([slug]) => slug);
  if (missing.length > 0) {
    return { kind: "missing-dependency", on: missing };
  }
  const ambiguous = [...counts].filter(([, matches]) => matches.length > 1).map(([slug]) => slug);
  if (ambiguous.length > 0) {
    return { kind: "ambiguous-dependency", on: ambiguous };
  }
  const waiting = [...counts]
    .filter(([, matches]) => !dependencySatisfied({ dependency: matches[0] }))
    .map(([slug]) => slug);
  return waiting.length > 0 ? { kind: "waiting", on: waiting } : undefined;
}

/**
 * Whether a dependency has ended in a way that unblocks what waits on it.
 *
 * A doc says so with `status: done`. A settled ASK never does: `./askRow.ts`'s `settledAskRefusal` keeps a
 * settled ask at `status: ready` on purpose, and its ending lives in `settlement:` instead — so before this
 * predicate a row blocked on an ask stayed `waiting` forever after that ask was filed or answered, while
 * `./boardState.ts` (which reads the settlement) already placed the same ask under `DONE`. A `declined` ask is
 * a terminal-not-shipped ending and does NOT satisfy the edge, exactly as `boardState.ts` treats it.
 *
 * This is the AUTHORED reading only and reads no journal: a row ended by a `closed` event keeps `status: ready`.
 * `handover start` therefore narrows a `waiting` answer by the board composer's own verdict afterwards
 * (`../cli/commands/handover/startGates.ts`'s `narrowWaiting`) rather than this predicate growing a journal read.
 */
function dependencySatisfied({ dependency }: { dependency: HandoverDoc | undefined }): boolean {
  if (dependency === undefined) {
    return false;
  }
  if (dependency.status === "done") {
    return true;
  }
  return dependency.kind === "ask" && (dependency.settlement === "filed" || dependency.settlement === "answered");
}
