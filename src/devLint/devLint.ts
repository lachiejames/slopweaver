/**
 * The `dev lint` verb — the repo's whole static-analysis bar behind one door, so package.json keeps a
 * handful of scripts instead of a dozen. It runs every check in its lane (no short-circuit — one run tells
 * you everything that's wrong), then exits non-zero if any failed. `--lane local` runs only the checks CI
 * cannot see the subject of (see "two LANES" below); the default lane runs the lot:
 *
 *   biome-imports (import order and unused imports, Biome as the organiser only) · prettier (format, incl.
 *   code) · oxlint (syntactic + type-aware bug rules,
 *   `--type-aware`) · cognitive-complexity, house-rules, testing-discipline, redos-check (bespoke gates that
 *   replace what ESLint used to carry — see each module's own doc for why) · knip (dead code) · yarn
 *   constraints (dep pins) · hygiene (public leak gate) · door-coverage (admit-seam ratchet).
 *
 * ESLint is gone entirely (eslint-oom-crash-blocks-validate), and Biome runs only as the import organiser,
 * its linter and formatter off. oxlint's `--type-aware` mode
 * (backed by `oxlint-tsgolint`) now covers every type-aware rule ESLint used to run, natively, without a V8
 * heap to set a ceiling on. That retired the heap-ceiling insurance this repo once needed FOR ESLINT. Its own
 * cost grew with the tree — 5.71 GB resident with its workers capped, measured on its row in `gateGroups.ts`
 * — which is why it runs alone. It did not retire the need for heap headroom in general, which the next section is about, and
 * this comment claimed otherwise until a bespoke type-aware gate started OOMing CI at random.
 *
 * ## A type-aware gate costs a whole-repo `ts.Program`, and that is a floor rather than a leak
 *
 * Read this before writing the next bespoke gate; it is the difference between a rule that costs nothing and
 * one that costs two gigabytes.
 *
 * Almost every gate below reads source with the seam's `withSourceFile` — one file at a time, syntax only, tens of
 * megabytes. Exactly one, `named-object-params`, needs RESOLVED TYPES, so it builds a real `ts.Program`.
 * Measured on this repository: the Program loads 18,642 source files for 6,716 in-scope roots,
 * and the gate's LIVE heap — what survives a forced major GC, which is the only number that decides whether
 * a process fits under a ceiling — is 3,829 MiB. For comparison, `tsc --noEmit` over the same config peaks
 * at 4,374 MiB of RSS. This is simply what a whole-repo type pass costs.
 *
 * It used to cost 4,755 MiB, and the 926 MiB difference is the one part of it that was NOT a floor: the gate
 * ran `getSemanticDiagnostics()` over the whole Program before its scan, to fail closed, and on a clean run
 * — every run that is not already red — discarded the answer. It now runs that pass only after a violation
 * has been found and printed, where the answer is read, and only over the files carrying one: whole-repo,
 * it took the violation path past the 8,192 MiB ceiling. `namedObjectParams.ts`'s own header carries the
 * argument that this cannot produce a false clean, and `HEAP_BUDGET_MIB` in `namedObjectParamsHeap.ts`
 * carries the measurement.
 *
 * Three consequences, each of them measured rather than reasoned:
 *
 *   - **Do not try to slice it.** Splitting the roots into four sequential Programs was tried: peak went UP,
 *     to 3,160 MB, because the transitive closure of any quarter of the roots is 12,140 of 12,598 files —
 *     96% of the whole program, for a quarter of the work. A cohesive codebase has no cheap seam in its type graph.
 *   - **Do not build a second Program.** A second type-aware gate that stands up its own Program pays the
 *     whole 2 GB again. If you need resolved types, add your rule to `namedObjectParams.ts`'s existing pass —
 *     it already holds a Program and a checker, and a rule that rides them is close to free.
 *   - **Do not expect `oxlint-tsgolint` to host it.** It is the obvious idea and it does not work today: its
 *     JS plugin API is alpha and exposes no type information at all. The installed package says so in its own
 *     typings — `parserServices: Readonly<Record<string, unknown>>`, documented as "Oxlint does not offer any
 *     parser services." A custom oxlint rule gets an AST and a scope manager, never a `TypeChecker`, and
 *     tsgolint's own type-aware rules are compiled Go. Re-check it when the plugin API leaves alpha; until
 *     then a checker-backed house rule has to be ours.
 *
 * The gate that pays this cost measures and budgets it (`HEAP_BUDGET_MIB` in `namedObjectParamsHeap.ts`) and CI
 * gives the Lint step the headroom to run it (`.github/workflows/ci.yml`). Neither is a workaround.
 *
 * ## Which is why there are two LANES, and why raising the ceiling was refused instead
 *
 * The rule: never raise the heap ceiling. Raising the heap limit without reducing the memory the underlying
 * code needs only moves the cost, and eventually the number of concurrent seats has to fall because the
 * machine panics. The fix is not a smaller gate: certain checks run on CI instead of this machine, and CI is
 * watched instead of running heavy operations locally.
 *
 * So `--lane local` narrowed, and the `pre-push` hook runs that lane instead of the whole of `yarn validate`.
 * Each gate itself is untouched: same budget, same tripwire, same verdict, now only ever on a runner.
 * `yarn lint` and `yarn validate` still run everything for anyone who wants the whole lap on their own
 * machine, and CI has always run it — which is why the offload costs no CI time at all.
 *
 * ## The same rule holds on wall clock, not only memory
 *
 * The repo-wide stack-operation lock is held across
 * the `pre-push` gate, so a five-minute gate is a five-minute lock and unrelated sessions serialise behind
 * it. Rescoping the lock, a bounded wait and hoisting the gate out of the critical section are all refused:
 * the heavy work moves out of local and into CI, and CI is watched with Slopweaver's own verbs, the most
 * token-efficient way to do it. The lock is untouched by that rule — its critical section shrinks because the
 * gate inside it got light.
 *
 * ## The lane is an OPT-IN, and the criterion is CI's reach
 *
 * Twice the lane was narrowed by naming the expensive gates, and twice it grew back — an opt-out filter
 * drops what somebody remembered to flag and keeps everything else, so every gate added since rode the
 * `pre-push` hook by default. MEASURED at load 13-15: `yarn lint:local` took 220.8s and 273.2s while holding
 * that repo-wide lock, and a seat's push was refused outright by a `node` crash inside a gate it did not
 * need. The answer is to stop naming exceptions and invert the rule — aggressively offload
 * work to CI, so the local lane is _a secrets scan and a working-tree check and nothing else_.
 *
 * So {@link LintCheck.offRepoState} is an OPT-IN and {@link checksForLane} filters ON it. The criterion is
 * not cost and never was: **a gate is in the local lane if, and only if, CI cannot see its subject.** A gate
 * CI can run is CI's whatever it costs; a gate CI cannot run has nowhere else to go, so dropping it here
 * would delete it rather than offload it. Five gates meet that test today and every other one is CI's —
 * `ci-offload-contract` proves CI still runs the full lane, which is what makes the other 58 safe.
 *
 * **A lane is a subset of THIS plan, never a second list.** `lintChecks` still returns every check, so
 * `gate-registration` — which proves every `*.entry.ts` is wired to the runner — keeps comparing
 * against the whole thing. A lane that could hide a gate from that proof would be the defect this directory
 * exists to prevent.
 *
 * **Deliberate, accepted gaps** — narrow rules dropped rather than reimplemented, each checked against this
 * codebase's current state before being accepted (none would have fired here anyway):
 *   - Biome's `noEvolvingTypes`/`noImplicitAnyLet` (implicit-any escape hatches `strict` itself permits),
 *     `noVoidTypeReturn` (a value returned where `void` was declared — also TS-permitted), and
 *     `noDynamicNamespaceImportAccess` (a tree-shaking hint) — each real but narrow, and each would need
 *     type-checker-level analysis to reimplement faithfully; noConstAssign/noUnusedImports/useIsNan/
 *     noAccumulatingSpread all have direct oxlint equivalents and are already covered.
 *   - Biome's `useSortedKeys`/`useSortedProperties` assist actions (auto-sorted object keys) — cosmetic
 *     ordering, not a bug class; Prettier has no equivalent and none was built.
 *   - `eslint-plugin-regexp`'s `no-misleading-unicode-character` (a regex character-class Unicode-boundary
 *     nicety) and `eslint-plugin-sonarjs`'s `no-collapsible-if`/`no-duplicated-branches`/
 *     `no-identical-functions` (style/duplication hints, all `warn`) — narrower value than the ReDoS check
 *     and cognitive-complexity cap this PR did port, and oxlint has no equivalent for any of the four.
 *
 * ## `--only <gate>[,<gate>...]` narrows the plan, and refuses rather than widening it
 *
 * A session that has just fixed one gate's finding wants that gate re-checked, not a whole lap. `--only`
 * selects by name from the same `lintChecks` registry — a FILTER, never a second list, for the same reason
 * a lane is (see {@link checksForLane}) — and every unusable spelling REFUSES: a name that is not a gate,
 * `--only` with nothing after it, and a selection this lane runs none of. Falling back to the full plan is
 * what the flag did before it was implemented at all, and it is the failure being closed: the tail was never
 * read, so `dev lint --only jsdoc-tags` looked accepted and quietly charged the caller forty gates.
 *
 * A narrow run says so in the line a caller looks at (`onlyScopeLine`, `./lintVerdict.ts`), because a `PASS`
 * covering one gate of forty reads as the whole bar exactly the way a `local` green used to.
 *
 * Pure core / effectful shell: `lintChecks` (the plan), `planLintRun` (which checks a tail resolves to) and
 * `./lintVerdict.ts` (the verdict and every closing line) are pure and unit-tested. HOW the plan is run — the concurrency, the per-gate
 * ceiling and the witness that concurrency happened — is `gateRunner.ts`, and `runDevLint` is the thin edge
 * that joins the two.
 */
import { join } from "node:path";
import { EXIT_OK } from "../cli/exitCodes.js";
import { err, ok as okResult, type Result } from "../lib/result.js";
import { machineConcurrency } from "./gateCapacity.js";
import { bespokeRatchets, externalChecks } from "./gateGroups.js";
import { runLintSegments } from "./gateRunner.js";
import { previousGateSeconds, recordGateSeconds } from "./gateSeconds.js";
import { lapClose } from "./lintVerdict.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import {
  isSeatCheck,
  prepareSeatLint,
  projectSeatChecks,
  type SeatLapHolder,
  type SeatLintContext,
  type SeatPreparationError,
  seatContextLines,
  seatOxlintWithheld,
  seatUncovered,
} from "./seatLint.js";

/** One static-analysis check: its label plus the exact command to spawn. */
export interface LintCheck {
  readonly name: string;
  readonly cmd: string;
  readonly args: readonly string[];
  /**
   * Whether CI cannot see this gate's SUBJECT, because that subject is state which exists only on the
   * machine the fleet runs on: the private hygiene denylist, the bronze corpus, the operator's
   * `profile.json`, the secrets store, the handover register. Absent means CI runs it.
   *
   * **This is the only reason a gate is in the local `pre-push` lane** — see {@link checksForLane}, which
   * filters ON it. The criterion is deliberately not cost: a gate CI can run is CI's however slow it is,
   * and a gate CI cannot run has nowhere else to go, so dropping it from this lane would DELETE it rather
   * than offload it. Cost is what decides whether a gate should exist at all, never which lane it sits in.
   *
   * Each flagged gate's own module carries the state it reads and why that state cannot reach a runner.
   */
  readonly offRepoState?: true;
  /**
   * Whether this gate's peak memory is so near the whole runner's budget that NOTHING may run beside it.
   *
   * An opt-in, like {@link offRepoState}, and for the same reason: the scheduler reads a field rather than
   * matching a name, so the next heavy gate has something to copy and its declaration says what it needs.
   * A name match in {@link runDevLint} would be invisible from here, which is exactly where a reader of a
   * memory-hungry gate is standing.
   *
   * **The criterion is a MEASURED live heap against the runner's declared floor**, never a suspicion that a
   * gate looks expensive. Setting this costs the whole lap that gate's runtime in serialisation, so a gate
   * flagged on a hunch is a real cost bought with nothing.
   *
   * **The two whole-Program gates carry it.** `named-object-params`, MEASURED on `main`
   * AFTER the 926 MiB semantic pass was removed: it printed `live heap 3837 MiB of a 3950 MiB
   * budget`. What it costs beside a full pool is unmeasured, and a lap that OOMs costs more than the serialised
   * runtime, so it runs alone. Reproduce
   * with `yarn slopweaver dev lint --only named-object-params`, which prints that line. `oxlint`'s type-aware
   * pass peaks at 5.71 GB resident even with its workers capped; its row in `gateGroups.ts` carries the
   * measurement.
   */
  readonly exclusive?: true;
  /**
   * Whether this gate runs ALONE and LAST, after the pool has drained. Set by a projection, never a registry
   * row: the seat lane's changed-file `oxlint` (`./seatLint.ts`), which peaks past the bespoke-gate slot yet is
   * not the whole-tree peak, and runs last so the lane can withhold it at the moment it would spawn.
   */
  readonly runsLast?: true;
  /**
   * Variables set on this gate's process only, over the runner's own environment. For a native tool whose
   * resource knob is an environment variable rather than a flag — `oxlint`'s type-aware pass spawns a Go
   * binary that reads `GOMAXPROCS` and has no flag of its own. Absent means the gate inherits the runner's
   * environment unchanged.
   */
  readonly env?: Readonly<Record<string, string>>;
}

/** One check's outcome. */
export interface LintCheckResult {
  readonly name: string;
  readonly ok: boolean;
  /** Wall-clock milliseconds the gate ran for, so a lap says which gate is expensive without a stopwatch. */
  readonly elapsedMs?: number;
  /**
   * Present only when the gate was killed for exceeding {@link GATE_TIMEOUT_MS} — never for a gate that
   * failed on its own findings. Absent means it exited by itself, pass or fail.
   */
  readonly hung?: true;
  /**
   * Present only when the lane refused to SPAWN this gate, and why — the seat lane's oxlint while a lap holds
   * the machine. Such a result is never `ok`: a gate that did not run passed nothing.
   */
  readonly withheld?: string;
  /**
   * Present only on a gate that RAN and failed: every byte it printed, stdout then stderr, so the closing
   * recap (`failedGateRecapLines`, `./lintVerdict.ts`) can repeat its finding beside the verdict.
   */
  readonly output?: string;
}

/**
 * Which machine a lint run is on. `full` is every check and is the default everywhere; `local` is only the
 * ones flagged {@link LintCheck.offRepoState}, and is what the `pre-push` hook runs; `seat` is what a working
 * seat runs before handback — every gate but the whole-project ones, against the base it resolves itself
 * (`./seatLint.ts`).
 *
 * @internal — the parameter type of {@link checksForLane}, exported so a caller can name it; nothing
 * outside this module and its test constructs one.
 */
export type LintLane = "full" | "local" | "seat";

/**
 * What {@link parseLintLane} and {@link parseOnlySelection} report when their flag ends the tail with no value
 * after it. A named constant rather than an empty string, so the refusal reads `not \`(no value)\`` instead
 * of `not \`\``.
 *
 * @internal — this module's own refusal text and its test.
 */
export const NO_FLAG_VALUE = "(no value)";

/**
 * The ordered list of checks `dev lint` runs, resolved against a working directory (local JS bins live in
 * `node_modules/.bin`). Pure — takes the cwd so it stays testable.
 *
 * @param cwd the repo root the checks run from
 * @returns the checks in run order
 */
export function lintChecks({ cwd }: { cwd: string }): readonly LintCheck[] {
  const bin = ({ name }: { name: string }): string => join(cwd, "node_modules", ".bin", name);
  return [...externalChecks({ bin }), ...bespokeRatchets({ bin })];
}

/**
 * The subset of the plan a lane runs. Pure, and deliberately a FILTER over the whole plan rather than a
 * second list: `lintChecks` stays the single registry every other gate reads (`gate-registration` compares
 * it against every `*.entry.ts`), so a lane can never become a place a check hides from that proof.
 *
 * **The local lane is an OPT-IN**, and that direction is the whole rule. An opt-out filter
 * keeps every gate nobody remembered to flag, so the lane grew back twice after being narrowed; an opt-in
 * one means a gate joins `pre-push` only by declaring {@link LintCheck.offRepoState} — that CI cannot see
 * its subject. Everything else is CI's, and `ci-offload-contract` is what proves CI still runs it.
 *
 * @param checks the whole plan, in run order
 * @param lane which machine this run is on
 * @returns the checks that lane runs, in the same order
 */
export function checksForLane({
  checks,
  lane,
}: {
  checks: readonly LintCheck[];
  lane: LintLane;
}): readonly LintCheck[] {
  if (lane === "full") {
    return checks;
  }
  if (lane === "seat") {
    return checks.filter((check) => isSeatCheck({ check }));
  }
  return checks.filter((check) => check.offRepoState === true);
}

/**
 * Read `--lane` off the verb tail. Absent reads as `full`; an unrecognised value is REPORTED rather than
 * defaulted, so `runDevLint` can refuse it. Defaulting a typo either way is wrong here — to `local` it
 * silently skips all but five gates, and to `full` it silently runs a lap the caller's machine may not have
 * asked for — and a hook that swallows a misspelt flag is a hook nobody can tell is misconfigured.
 *
 * @param rest the verb tail, already split into words
 * @returns the lane to run, and the unrecognised value when there was one — {@link NO_FLAG_VALUE} when
 *   `--lane` ended the tail with nothing after it
 */
export function parseLintLane({ rest }: { rest: readonly string[] }): {
  readonly lane: LintLane;
  readonly unknown: string | undefined;
} {
  const at = rest.indexOf("--lane");
  if (at === -1) {
    return { lane: "full", unknown: undefined };
  }
  const value = rest[at + 1];
  if (value === undefined) {
    return { lane: "full", unknown: NO_FLAG_VALUE };
  }
  if (value === "full" || value === "local" || value === "seat") {
    return { lane: value, unknown: undefined };
  }
  return { lane: "full", unknown: value };
}

/**
 * Read `--only` off the verb tail: a comma-separated list of gate names, narrowing the plan to exactly those
 * checks. Absent reads as the whole plan.
 *
 * This flag was accepted-looking and did nothing for as long as it existed — a session that spelled
 * `dev lint --only jsdoc-tags` to re-check one gate silently paid a whole lap, because the tail was never
 * read at all. So every failure mode here REFUSES rather than falling back to the full plan: a name that is
 * not a gate, or `--only` with nothing after it, is the caller having budgeted a narrow run, and running
 * forty gates instead is the exact defect this closes.
 *
 * @param rest the verb tail, already split into words
 * @returns the requested gate names (undefined when `--only` is absent), and the unusable value when there
 *   was one — {@link NO_FLAG_VALUE} when `--only` named nothing at all
 * @internal — {@link planLintRun} and this module's test.
 */
export function parseOnlySelection({ rest }: { rest: readonly string[] }): {
  readonly only: readonly string[] | undefined;
  readonly unknown: string | undefined;
} {
  const at = rest.indexOf("--only");
  if (at === -1) {
    return { only: undefined, unknown: undefined };
  }
  const value = rest[at + 1];
  if (value === undefined) {
    return { only: undefined, unknown: NO_FLAG_VALUE };
  }
  const names = value.split(",").map((name) => name.trim());
  const wanted = names.filter((name) => name.length > 0);
  if (wanted.length === 0) {
    return { only: undefined, unknown: NO_FLAG_VALUE };
  }
  return { only: wanted, unknown: undefined };
}

/** The checks one run actually spawns, and what it deliberately did not. */
export interface LintRun {
  /** The checks to spawn, in plan order. */
  readonly running: readonly LintCheck[];
  /** Selected checks this LANE does not run, in plan order — what an `EMPTY_SELECTION` refusal names. */
  readonly skipped: readonly string[];
  /** Whether `--only` narrowed the plan, so the verdict can say the run was not the whole bar. */
  readonly partial: boolean;
  /**
   * How much of the WHOLE plan this lane runs, whatever `--only` then narrowed — what
   * {@link laneVerdictLine} reports. Derived over `lintChecks` rather than over the selection on purpose:
   * the claim this carries is about the LANE, and what one `--only` run actually spawned is
   * {@link onlyScopeLine}'s separate line.
   */
  readonly laneScope: { readonly ran: number; readonly total: number };
  /** Which lane this run is, so the verdict knows how to say what it left out. */
  readonly lane: LintLane;
  /** What a `seat` run does not cover, by name, for {@link laneVerdictLine}; empty on every other lane. */
  readonly uncovered: readonly string[];
}

/**
 * Why a lint run could not be planned. Two genuinely different kinds, so a discriminated union rather than
 * a shared string list: `BAD_INVOCATION` is a typo answered with usage, and `EMPTY_SELECTION` is a POLICY
 * refusal — every gate named was real, and the lane's own rule excluded all of them. Only the second gets
 * the four-line shape, and an adversarial review pass is what established that they were being conflated.
 */
export type DevLintPlanError =
  | { readonly code: "BAD_INVOCATION"; readonly reasons: readonly string[] }
  | { readonly code: "EMPTY_SELECTION"; readonly reasons: readonly string[] };

/**
 * Factories for {@link DevLintPlanError}, so a caller never hand-builds one.
 *
 * @internal — `planLintRun` is the only producer; a consumer branches on `code` instead.
 */
export const DevLintPlanErrors = {
  badInvocation: ({ reasons }: { reasons: readonly string[] }): DevLintPlanError => ({
    code: "BAD_INVOCATION",
    reasons,
  }),
  emptySelection: ({ reasons }: { reasons: readonly string[] }): DevLintPlanError => ({
    code: "EMPTY_SELECTION",
    reasons,
  }),
} as const;

/**
 * Resolve a verb tail against the whole plan into the exact checks one run spawns. Pure, so every refusal
 * below is unit-testable without spawning a single gate — the reason the flag parsing does not live inline
 * in {@link runDevLint}.
 *
 * Ordering matters and is deliberate: `--only` selects from the WHOLE plan and the lane filter then applies,
 * so `--only named-object-params --lane local` selects a real gate and then finds the lane runs none of it.
 * That is a refusal rather than an empty green: `composeLint` also fails a lap that planned no checks, but a
 * typed refusal names WHY nothing ran, where a bare `FAIL` from a run that spawned nothing would not.
 *
 * @param checks the whole plan, in run order
 * @param rest the verb tail, already split into words
 * @param seat what the `seat` lane resolved before planning — its base and changed files; required for that lane
 *   and ignored by every other
 * @returns the resolved run, or a typed {@link DevLintPlanError} saying which kind of failure it was
 */
export function planLintRun({
  checks,
  rest,
  seat,
}: {
  checks: readonly LintCheck[];
  rest: readonly string[];
  seat?: SeatLintContext | undefined;
}): Result<LintRun, DevLintPlanError> {
  const { lane, unknown: badLane } = parseLintLane({ rest });
  if (badLane !== undefined) {
    return refuseInvocation({ reason: `dev lint: --lane takes \`full\`, \`local\` or \`seat\`, not \`${badLane}\`` });
  }
  if (lane === "seat" && seat === undefined) {
    return refuseInvocation({
      reason: "dev lint: the `seat` lane is planned only once its base is resolved — `runDevLint` resolves it",
    });
  }
  const seatFor = lane === "seat" ? seat : undefined;
  const { only, unknown: badOnly } = parseOnlySelection({ rest });
  if (badOnly !== undefined) {
    return refuseInvocation({
      reason: `dev lint: --only takes one or more comma-separated gate names, not \`${badOnly}\``,
    });
  }
  const whole = laneSplit({ checks, lane, seat: seatFor });
  const laneScope = { ran: whole.running.length, total: checks.length };
  const uncovered = lane === "seat" ? seatUncovered({ checks }) : [];
  if (only === undefined) {
    return okResult({ lane, laneScope, partial: false, uncovered, ...whole });
  }
  const unnamed = only.filter((name) => !checks.some((check) => check.name === name));
  if (unnamed.length > 0) {
    return err(
      DevLintPlanErrors.badInvocation({
        reasons: [
          `dev lint: --only names no such gate: ${unnamed.join(", ")}`,
          `known gates: ${checks.map((check) => check.name).join(", ")}`,
        ],
      }),
    );
  }
  const selected = checks.filter((check) => only.includes(check.name));
  const split = laneSplit({ checks: selected, lane, seat: seatFor });
  if (split.running.length === 0) {
    // POLICY, not a bad invocation: every name was real and the lane's own rule excluded them.
    const reasons = [`dev lint: --only selected nothing the \`${lane}\` lane runs: ${split.skipped.join(", ")}`];
    if (seatFor !== undefined && split.skipped.includes("oxlint")) {
      reasons.push("the seat lane narrows oxlint to the changed files, and this branch changed none oxlint lints");
    }
    return err(DevLintPlanErrors.emptySelection({ reasons }));
  }
  return okResult({ lane, laneScope, partial: true, uncovered, ...split });
}

/**
 * A `BAD_INVOCATION` plan failure carrying one reason — the shape three of {@link planLintRun}'s refusals share.
 *
 * @param reason what about the tail could not be planned
 * @returns the typed failure
 */
function refuseInvocation({ reason }: { reason: string }): Result<never, DevLintPlanError> {
  return err(DevLintPlanErrors.badInvocation({ reasons: [reason] }));
}

/**
 * Split a selection into what a lane runs and what it drops. Pure, and shared by both arms of
 * {@link planLintRun} so the two can never disagree about what `skipped` means.
 *
 * @param checks the selected checks, in plan order
 * @param lane which machine this run is on
 * @param seat the seat lane's resolved base and changed files, present exactly when `lane` is `seat`; its checks
 *   are projected (`./seatLint.ts`), so membership is judged by NAME rather than by identity
 * @returns the checks to spawn and the names the lane dropped
 */
function laneSplit({
  checks,
  lane,
  seat,
}: {
  checks: readonly LintCheck[];
  lane: LintLane;
  seat: SeatLintContext | undefined;
}): {
  readonly running: readonly LintCheck[];
  readonly skipped: readonly string[];
} {
  const filtered = checksForLane({ checks, lane });
  const running = seat === undefined ? filtered : projectSeatChecks({ checks: filtered, seat });
  const ran = new Set(running.map((check) => check.name));
  return { running, skipped: checks.filter((check) => !ran.has(check.name)).map((check) => check.name) };
}

const USAGE = "usage: slopweaver dev lint [--lane full|local|seat] [--only <gate>[,<gate>...]]";

/**
 * Run the lint bar for one lane. The effectful shell: spawn the checks in the order `lintSchedule` gives
 * them, capture each one's own diagnostics, replay them as they settle, then print a summary in plan order,
 * record each gate's seconds for the next run's order (a whole-lane run only), and return the composed exit
 * code.
 *
 * **The seat lane withholds its oxlint while a lap holds the machine**, asked at the moment oxlint would spawn
 * (it runs last): `readLapHolder` is the command layer's read of the lap lock, injected because this tree may
 * not import `src/cli/commands/`.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @param readLapHolder reads the live lap holding this machine now, `undefined` when none does
 * @returns the process exit code (0 all-clear, 4 all that ran passed but a gate was withheld, 1 any check
 *   failed or `--lane` named a lane that isn't one)
 */
export async function runDevLint({
  argv,
  readLapHolder,
}: {
  argv: readonly string[];
  readLapHolder: () => SeatLapHolder | undefined;
}): Promise<number> {
  const rest = argv.slice(3);
  if (rest.includes("--help") || rest.includes("-h")) {
    process.stdout.write(`${USAGE}\n`);
    return EXIT_OK;
  }
  const cwd = process.cwd();
  const planned = lintChecks({ cwd });
  const seat = prepareSeatIfAsked({ cwd, rest });
  if (seat.isErr()) {
    // devlint: not-a-refusal -- the seat lane could not resolve its base or its scope, so no gate ran
    process.stderr.write(`${seat.error.message}\n`);
    return 1;
  }
  const resolved = planLintRun({ checks: planned, rest, seat: seat.value });
  if (resolved.isErr()) {
    return reportPlanRefusal({ error: resolved.error });
  }
  const { lane, partial, running } = resolved.value;
  const priorSeconds = previousGateSeconds();
  const startedAt = Date.now();
  const concurrency = machineConcurrency();
  const results = await runLintSegments({
    checks: running,
    concurrency,
    cwd,
    priorSeconds,
    withhold: ({ check }) => {
      if (lane !== "seat" || check.name !== "oxlint") {
        return undefined;
      }
      return seatOxlintWithheld({ holder: readLapHolder() });
    },
  });
  const wallMs = Date.now() - startedAt;
  // A seat run's oxlint is narrowed, so its seconds would mislead the next whole-tree run's schedule.
  if (!partial && lane !== "seat") {
    recordGateSeconds({ previous: priorSeconds, results });
  }
  const close = lapClose({ concurrency, results, run: resolved.value, totalGates: planned.length, wallMs });
  process.stdout.write(`\n${close.lines.join("\n")}\n`);
  return close.exit;
}

/**
 * Resolve the seat lane's base and scope when the tail asks for that lane, printing them before any gate runs.
 * Split from {@link runDevLint} for the body cap; a bad `--lane` value is left to {@link planLintRun} to refuse.
 *
 * @param cwd the checkout the run is in
 * @param rest the verb tail
 * @returns the seat context, `undefined` for every other lane, or the state the seat lane could not get past
 */
function prepareSeatIfAsked({
  cwd,
  rest,
}: {
  cwd: string;
  rest: readonly string[];
}): Result<SeatLintContext | undefined, SeatPreparationError> {
  if (parseLintLane({ rest }).lane !== "seat") {
    return okResult(undefined);
  }
  const prepared = prepareSeatLint({ cwd, nowMs: Date.now() });
  if (prepared.isOk()) {
    for (const line of seatContextLines({ seat: prepared.value })) {
      process.stdout.write(`${line}\n`);
    }
  }
  return prepared;
}

/**
 * Print a plan failure and return its exit code, saying which KIND it was.
 *
 * Split from {@link runDevLint} for the body cap. The two kinds get different endings on purpose: a typo is
 * answered with usage, and an empty lane selection is a policy refusal that earns the four-line shape.
 *
 * @param error the typed plan failure
 * @returns 1, the exit code either kind gives
 */
function reportPlanRefusal({ error }: { error: DevLintPlanError }): number {
  // devlint: not-a-refusal -- the reasons themselves, quoted; whether they are a POLICY refusal or a bad
  // invocation is decided just below
  process.stderr.write(`${error.reasons.join("\n")}\n`);
  if (error.code === "EMPTY_SELECTION") {
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "dev-lint-empty-selection" }),
        detail: "the lane runs none of the gates named",
      })}\n`,
    );
    return 1;
  }
  // devlint: not-a-refusal -- a bad invocation of the runner itself, answered with usage; no gate ran, so
  // there is no policy verdict to refuse with
  process.stderr.write(`${USAGE}\n`);
  return 1;
}
