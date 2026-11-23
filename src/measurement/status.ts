/**
 * The single pane — rendered from measured facts, with no field it is allowed to invent.
 *
 * ## The defect this exists for
 *
 * A hand-maintained board lies. Twice a stale block on a published page caused duplicate work:
 * once three identical prompts pasted into a chat that had already shipped, once two competing pull requests
 * for the same fix. The fix is not discipline. **It is that status must be DERIVED, never authored** — so
 * nothing here reads a stored view and nothing here caches. The caller measures at call time and this renders
 * what it measured.
 *
 * ## An absent row reads as "fine", so there are no absent rows
 *
 * Every fact is a {@link Measured} value: either the answer or the reason there is no answer. That is the
 * whole reason the type exists rather than `T | undefined`. A pane that silently omits the PR row for a
 * workstream whose `gh` call failed is indistinguishable from one that has no PR — and the second is normal,
 * which is exactly what makes the first invisible.
 *
 * ## Liveness comes from the process; progress comes from git
 *
 * Liveness is asked of the SESSION, not of a recorded pid — see {@link ./sessions} for why the pid was
 * always the wrong key.
 *
 * Measured: `claude -p` BUFFERS its output until the turn ends, so a zero-byte log is the normal state
 * of a healthy agent that has been working for forty minutes. There is deliberately no "stalled" warning
 * keyed on log silence — it would fire on every healthy agent in the fleet. What this prints instead is
 * whether the process is alive, and separately what the branch has actually gained.
 *
 * Pure: the caller supplies every fact. No filesystem, no subprocess, no clock.
 */

import type { Consistency } from "../handover/consistency.js";
import type { DocStatus } from "../handover/doc.js";
import { type RunClaim, renderClaim } from "./overlap.js";

/** What a PR's check rollup says. `unknown` is a first-class answer: nothing could be asked. */
export type CheckRollup = "green" | "failing" | "pending" | "none" | "unknown";

/**
 * A fact, or the reason it could not be established.
 *
 * `known: false` is not an error path. A repository that is not a checkout, a `gh` that is not authenticated,
 * a doc that declares no branch — all of them are ordinary, and all of them must print their reason rather
 * than leave a gap a reader will fill in optimistically.
 */
export type Measured<T> = { readonly known: true; readonly value: T } | { readonly known: false; readonly why: string };

/**
 * Wrap a fact that was measured.
 *
 * @param value the measured value
 * @returns the known variant
 */
export function measured<T>({ value }: { value: T }): Measured<T> {
  return { known: true, value };
}

/**
 * Wrap the reason a fact could not be measured.
 *
 * @param why one phrase saying what stopped it, fit to print on the pane
 * @returns the unknown variant
 */
export function unmeasurable<T>({ why }: { why: string }): Measured<T> {
  return { known: false, why };
}

/** What git says about a workstream's branch. */
export interface GitFacts {
  /**
   * WHICH directory was measured.
   *
   * Printed rather than implied, because a workstream's work can legitimately live in three places — the
   * worktree its drive launched in, a fleet worktree nobody has launched in yet, or the repository's own
   * checkout — and a branch name alone does not say which of them these numbers came from.
   */
  readonly tree: string;
  readonly branch: string;
  /** Commits on the branch that are not on the base. */
  readonly commitsAhead: number;
  /** Files with uncommitted changes, staged or not. */
  readonly dirtyFiles: number;
  /** Whether the branch exists on the remote. */
  readonly onRemote: boolean;
}

/** What the pull request and its check rollup say. `undefined` where a PR is open but has no rollup. */
export interface PrFacts {
  readonly number: number;
  readonly rollup: CheckRollup;
  /** The named failing checks, so the pane says WHICH rather than how many. */
  readonly failing: readonly string[];
  readonly isDraft: boolean;
}

/** What is known about the session driving a run. */
export interface AgentFacts {
  /**
   * The pid the journal recorded, kept as EVIDENCE only.
   *
   * It is whichever process wrote the line — the `slopweaver` command for a hand-opened run, a one-turn child
   * for a driver-launched one — and never the session's own process. Asking it about liveness is what made
   * every row read `exited`. See {@link ./sessions}.
   *
   * `undefined` where the journal named a session but no process — which is now a printable row rather than
   * no row at all, because the session is what identifies the drive.
   */
  readonly pid: number | undefined;
  /** Whether the SESSION is alive, or the reason that could not be established. */
  readonly liveness: Measured<boolean>;
  readonly sessionId: string;
  /** Where a turn's buffered output would land, if one wrote to it. */
  readonly logPath: string;
}

/** How many of a doc's declared probes did what. */
export interface ProbeTally {
  readonly passed: number;
  readonly failed: number;
  /** Never folded into `failed`: "nothing looked" is a different answer from "it is not there". */
  readonly unchecked: number;
}

/** Everything the pane prints about one workstream, all of it measured at call time. */
export interface WorkstreamStatus {
  readonly slug: string;
  /** The run's derived phase, or the reason there is no run. */
  readonly phase: "open" | "waiting-on-owner" | "closed" | "no-run";
  /**
   * What the doc itself claims, printed as evidence beside `phase` — never folded into it. `phase` stays the
   * one field a caller may treat as true; this is what the author wrote, which is exactly the thing `phase`
   * exists to check rather than trust.
   */
  readonly authoredStatus: DocStatus;
  /** The doc's own account of why that status is credible, when it wrote one. */
  readonly statusSummary: string | undefined;
  /** Whether `authoredStatus` and the derived run journal agree — see `consistencyOf`. */
  readonly consistency: Consistency;
  readonly probes: ProbeTally;
  readonly git: Measured<GitFacts>;
  /** `null` inside a known value means "measured, and there is no PR" — distinct from "could not ask". */
  readonly pr: Measured<PrFacts | null>;
  /** `null` inside a known value means "measured, and no agent has been launched". */
  readonly agent: Measured<AgentFacts | null>;
  /** The last journal transition and its age in milliseconds. */
  readonly lastTransition: Measured<{ readonly kind: string; readonly ageMs: number }>;
  /** The question the run is waiting on, when it is. */
  readonly openQuestion: string | undefined;
  /**
   * What this run claims to be building, and whether that claim still stands.
   *
   * On the pane because the pane is the only surface that shows EVERY live run on the machine rather than this
   * session's. Four collisions in one night came from a session not knowing what a run in another terminal was
   * already building; a claim that is derived but never printed would not have prevented any of them.
   */
  readonly claim: RunClaim;
}

/** Milliseconds in the units a human reads an age in, largest first. */
const AGE_UNITS: readonly { readonly ms: number; readonly suffix: string }[] = [
  { ms: 86_400_000, suffix: "d" },
  { ms: 3_600_000, suffix: "h" },
  { ms: 60_000, suffix: "m" },
  { ms: 1_000, suffix: "s" },
];

/**
 * An age as one short token: `12m`, `3h`, `2d`.
 *
 * A negative age is printed as such rather than clamped. It means the journal holds a timestamp from the
 * future — a clock skew or a hand edit — and hiding that would make the pane quietly wrong about the one
 * thing it is for.
 *
 * @param ageMs the age in milliseconds
 * @returns the rendered age
 */
export function renderAge({ ageMs }: { ageMs: number }): string {
  if (ageMs < 0) {
    return `${String(Math.round(ageMs / 1000))}s (IN THE FUTURE — the clock or the journal is wrong)`;
  }
  const unit = AGE_UNITS.find((candidate) => ageMs >= candidate.ms);
  return unit === undefined ? "just now" : `${String(Math.floor(ageMs / unit.ms))}${unit.suffix}`;
}

/** One `label  value` row, or the label plus the reason nothing could be measured. */
function row<T>({
  label,
  fact,
  render,
}: {
  label: string;
  fact: Measured<T>;
  render: (args: { value: T }) => string;
}): string {
  const body = fact.known ? render({ value: fact.value }) : `NOT MEASURED — ${fact.why}`;
  return `    ${label.padEnd(9)} ${body}`;
}

/** The probe tally, with `unchecked` always stated — a doc can only be done when nothing was skipped. */
function renderProbes({ probes }: { probes: ProbeTally }): string {
  const total = probes.passed + probes.failed + probes.unchecked;
  if (total === 0) {
    return "no `doneWhen:` probes — this doc's state cannot be computed from the repository";
  }
  return (
    `${String(probes.passed)}/${String(total)} passing` +
    `, ${String(probes.failed)} failing, ${String(probes.unchecked)} never examined`
  );
}

/** The git row. */
function renderGit({ value }: { value: GitFacts }): string {
  const dirty = value.dirtyFiles === 0 ? "clean" : `${String(value.dirtyFiles)} dirty file(s)`;
  return (
    `${value.branch} · ${String(value.commitsAhead)} commit(s) ahead · ${dirty} · ` +
    (value.onRemote ? "on the remote" : "NOT pushed") +
    `\n              tree ${value.tree}`
  );
}

/** The pull-request row, naming the failing checks rather than counting them. */
function renderPr({ value }: { value: PrFacts | null }): string {
  if (value === null) {
    return "none open for this branch";
  }
  const draft = value.isDraft ? "draft" : "NOT a draft";
  const failing = value.failing.length === 0 ? "" : ` — failing: ${value.failing.join(", ")}`;
  return `#${String(value.number)} (${draft}) · checks ${value.rollup}${failing}`;
}

/**
 * A session's liveness, with the recorded pid carried as evidence rather than as the answer.
 *
 * Exported because the console renders the same verdict and two spellings of "is this alive" is how two
 * surfaces start disagreeing about the same run.
 *
 * @param liveness the verdict
 * @param pid the journal's recorded process id, printed as evidence
 * @returns the phrase to print
 */
export function renderLiveness({ liveness, pid }: { liveness: Measured<boolean>; pid: number | undefined }): string {
  const evidence = pid === undefined ? "" : ` · journal recorded pid ${String(pid)}`;
  if (!liveness.known) {
    return `NOT MEASURED — ${liveness.why}${evidence}`;
  }
  return liveness.value ? `ALIVE${evidence}` : `gone${evidence}`;
}

/** The agent row. A zero-byte log is normal, so the log PATH is printed and its size deliberately is not. */
function renderAgent({ value }: { value: AgentFacts | null }): string {
  if (value === null) {
    return "none launched";
  }
  return (
    `session ${value.sessionId} — ${renderLiveness({ liveness: value.liveness, pid: value.pid })}` +
    `\n              log ${value.logPath}`
  );
}

/**
 * Render one workstream's block.
 *
 * @param status the measured facts
 * @returns the block's lines
 */
export function renderWorkstream({ status }: { status: WorkstreamStatus }): readonly string[] {
  const summary = status.statusSummary === undefined ? "" : ` — ${status.statusSummary}`;
  const lines = [
    `  ${status.slug}`,
    `    phase     ${status.phase}`,
    `    status    ${status.authoredStatus}${summary}`,
    `    probes    ${renderProbes({ probes: status.probes })}`,
    row({ fact: status.git, label: "branch", render: renderGit }),
    row({ fact: status.pr, label: "pr", render: renderPr }),
    row({ fact: status.agent, label: "agent", render: renderAgent }),
    row({
      fact: status.lastTransition,
      label: "last",
      render: ({ value }) => `${value.kind} ${renderAge({ ageMs: value.ageMs })} ago`,
    }),
    `    claim     ${renderClaim({ claim: status.claim })}`,
  ];
  if (status.consistency.kind === "contradiction") {
    lines.push(`    CONTRADICTION  ${status.consistency.reason}`);
  }
  if (status.openQuestion !== undefined) {
    lines.push(`    QUESTION  ${status.openQuestion}`);
  }
  return lines;
}

/**
 * What the pane's commits were counted against. A run given no `--base` resolves each repository's own trunk
 * instead of one shared branch, so there is no single name to print and the header says that.
 */
function countedAgainst({ base }: { base: string | undefined }): string {
  if (base === undefined) {
    return "each repository's own trunk";
  }
  return base;
}

/**
 * Render the whole pane.
 *
 * The header states what the numbers were measured FROM and when, because the failure this replaces is a
 * board that looked authoritative while describing a tree from days earlier.
 *
 * @param workstreams the measured facts, one per workstream, in the order to print them
 * @param nowIso when the measurement was taken
 * @param base the branch commits were counted against, or `undefined` when each repository's trunk was resolved
 * @returns the pane's lines
 */
export function renderFleetStatus({
  workstreams,
  nowIso,
  base,
}: {
  workstreams: readonly WorkstreamStatus[];
  nowIso: string;
  base: string | undefined;
}): readonly string[] {
  if (workstreams.length === 0) {
    return [
      "FLEET — nothing to report.",
      "No orchestration doc has an open run. `slopweaver handover list` shows what is runnable.",
    ];
  }
  return [
    `FLEET — ${String(workstreams.length)} workstream(s), every field measured at ${nowIso} against ` +
      `${countedAgainst({ base })}.`,
    "Nothing below is cached or hand-written. A row saying NOT MEASURED means exactly that.",
    "",
    ...workstreams.flatMap((status) => [...renderWorkstream({ status }), ""]),
  ];
}
