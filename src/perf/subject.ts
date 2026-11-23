/**
 * What `slopweaver dev profile` can be pointed at, and the one spawn plan all three forms resolve to.
 *
 * A gate, a test lane and a verb are three different things to a reader and ONE thing to a profiler: a
 * command line, an environment, and a process whose cost is being measured. Resolving them here — rather
 * than giving each its own branch in the shell — is what keeps the instrument single. Add a fourth subject
 * kind by adding a case to {@link resolveSubject}; nothing downstream of it knows which kind it got.
 *
 * **A gate's plan is TAKEN from `lintChecks`, never restated.** The gate list is the repository's own
 * registry of what runs and with which flags, and a profiler carrying its own copy would profile a command
 * that had quietly stopped being the one CI runs — which is precisely the class of drift the canon-freshness
 * rule exists for.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { LintCheck } from "../devLint/devLint.js";
import { FLOOR_BASE_ENV, resolveFloorBase } from "../devLint/gitAtCommit.js";
import { type ProfileSubjectError, ProfileSubjectErrors } from "./errors.js";

/** The vitest lanes, by the name of their config under `config/vitest/`. */
export const PROFILE_LANES: readonly string[] = ["unit", "subprocess", "integration"];

/** What the profiler was pointed at. */
export type ProfileSubject =
  | { readonly kind: "gate"; readonly name: string }
  | { readonly kind: "lane"; readonly name: string }
  | { readonly kind: "verb"; readonly argv: readonly string[] };

/** One command to spawn and measure. */
export interface SpawnPlan {
  /** What the report and the baseline call this run. */
  readonly label: string;
  readonly cmd: string;
  readonly args: readonly string[];
  /** A gate row's own environment (`LintCheck.env`), laid over the caller's exactly as `dev lint` lays it. */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * The spawn plan a subject names, resolved against the repository's own gate registry.
 *
 * @param subject what the caller asked to profile
 * @param checks `lintChecks({ cwd })`, injected so this stays pure and testable against a fixture list
 * @param binDir the checkout's `node_modules/.bin`, where the lane and verb runners live
 * @returns the plan, or the typed failure naming what the subject failed to match
 */
export function resolveSubject({
  subject,
  checks,
  binDir,
}: {
  subject: ProfileSubject;
  checks: readonly LintCheck[];
  binDir: string;
}): Result<SpawnPlan, ProfileSubjectError> {
  if (subject.kind === "gate") {
    const match = checks.find((check) => check.name === subject.name);
    if (match === undefined) {
      return err(
        ProfileSubjectErrors.unknownSubject({
          asked: subject.name,
          kind: "gate",
          known: checks.map((check) => check.name).toSorted(),
        }),
      );
    }
    if (match.env === undefined) {
      return ok({ args: match.args, cmd: match.cmd, label: `gate:${match.name}` });
    }
    return ok({ args: match.args, cmd: match.cmd, env: match.env, label: `gate:${match.name}` });
  }
  if (subject.kind === "lane") {
    if (!PROFILE_LANES.includes(subject.name)) {
      return err(ProfileSubjectErrors.unknownSubject({ asked: subject.name, kind: "lane", known: PROFILE_LANES }));
    }
    return ok({
      args: ["run", "--config", `config/vitest/${subject.name}.ts`],
      cmd: `${binDir}/vitest`,
      label: `lane:${subject.name}`,
    });
  }
  if (subject.argv.length === 0) {
    return err(ProfileSubjectErrors.emptyVerb());
  }
  return ok({
    args: ["src/cli/index.ts", ...subject.argv],
    cmd: `${binDir}/tsx`,
    label: `verb:${subject.argv.join(" ")}`,
  });
}

/**
 * The environment the subject is spawned under: the profiling flags, plus the phase report switched on.
 *
 * The flags ride `NODE_OPTIONS` because the three runners here — `tsx`, `vitest` and a gate's own `tsx`
 * entry — are JavaScript shims, so a flag placed on the command line would be read by the shim rather than
 * by node. That is the one honest use of this variable: `--cpu-prof` and `--expose-gc` are INSTRUMENTS, not
 * a ceiling raised to fit a program that outgrew one, which is what this whole workstream exists to remove.
 *
 * `SLOPWEAVER_HEAP_PHASES` is set unconditionally. A subject carrying no phase marks prints none and the
 * report says so; a subject carrying them costs one forced major GC per mark, which is exactly what a
 * profiling run is for.
 *
 * @param profileDir the throwaway directory V8 writes its documents into
 * @param cpu whether to ask for a CPU profile
 * @param heapProfile whether to ask for a sampled allocation profile
 * @param intervalMicros the CPU sampling interval, or `undefined` to leave V8 on its own default
 * @param inherited the caller's own `NODE_OPTIONS`, kept in front of the instruments so a ceiling the lane
 *   genuinely needs is not dropped by the act of measuring it
 * @returns the variables to merge over the caller's own environment
 */
export function profileEnv({
  profileDir,
  cpu,
  heapProfile,
  intervalMicros,
  inherited,
}: {
  profileDir: string;
  cpu: boolean;
  heapProfile: boolean;
  intervalMicros: number | undefined;
  inherited: string | undefined;
}): Readonly<Record<string, string>> {
  const flags: string[] = [];
  if (inherited !== undefined && inherited !== "") {
    flags.push(inherited);
  }
  flags.push("--expose-gc");
  if (cpu) {
    flags.push("--cpu-prof", "--cpu-prof-dir", profileDir);
    if (intervalMicros !== undefined) {
      flags.push("--cpu-prof-interval", String(intervalMicros));
    }
  }
  if (heapProfile) {
    flags.push("--heap-prof", "--heap-prof-dir", profileDir);
  }
  return { NODE_OPTIONS: flags.join(" "), SLOPWEAVER_HEAP_PHASES: "1" };
}

/**
 * The base a profiled subject compares against, so a diff gate is measured doing its comparison rather than
 * refusing for want of a base — which costs a fraction of the real run and would land in the baseline as if
 * it were the gate's cost.
 *
 * A base the caller exported is kept when the gates' own `resolveFloorBase` reads it as a full SHA, and a gate
 * is refused on any other value (short, malformed, all zeroes): each makes a diff gate refuse or skip rather
 * than compare, so measuring under one records a refusal as the gate's cost. Otherwise the merge-base
 * of HEAD and origin/main is handed over, as `dev lint --lane seat` hands it, with no fetch-age bound — a stale
 * base still runs the real comparison, so the cost measured is the gate's own. A gate whose base cannot be
 * resolved is refused with the fix; a lane or a verb proceeds, saying a diff gate inside it will refuse.
 *
 * @param inherited the caller's own `SLOPWEAVER_COVERAGE_BASE_SHA`, or `undefined` when unset
 * @param resolve the merge-base read, a seam so this stays pure
 * @returns the variables to lay over the spawn's environment and the line saying which base, or the refusal
 */
export function profileBase({
  subject,
  inherited,
  resolve,
}: {
  subject: ProfileSubject;
  inherited: string | undefined;
  resolve: () => Result<{ readonly baseSha: string }, { readonly detail: string }>;
}): Result<{ readonly env: Readonly<Record<string, string>>; readonly line: string }, string> {
  if (inherited !== undefined) {
    const judged = resolveFloorBase({ env: { [FLOOR_BASE_ENV]: inherited } });
    if (judged.kind === "sha") {
      return ok({ env: {}, line: `dev profile: base ${judged.sha}, from ${FLOOR_BASE_ENV} in the environment` });
    }
    if (subject.kind === "gate") {
      return err(
        `dev profile: cannot profile gate:${subject.name} against the exported base — ${judged.reason}; unset ` +
          `${FLOOR_BASE_ENV} to have the merge-base handed over, or export a full 40-character SHA`,
      );
    }
    return ok({
      env: {},
      line: `dev profile: the exported base will not compare (${judged.reason}), so a diff gate this ${subject.kind} runs refuses rather than compares`,
    });
  }
  const resolved = resolve();
  if (resolved.isOk()) {
    return ok({
      env: { [FLOOR_BASE_ENV]: resolved.value.baseSha },
      line: `dev profile: base ${resolved.value.baseSha} (merge-base of HEAD and origin/main), handed over as ${FLOOR_BASE_ENV}`,
    });
  }
  if (subject.kind === "gate") {
    return err(
      `dev profile: cannot hand gate:${subject.name} a base (${resolved.error.detail}), so a diff gate would be ` +
        `measured refusing rather than comparing — run \`git fetch origin main\`, or put ` +
        `\`${FLOOR_BASE_ENV}=$(git merge-base origin/main HEAD)\` in front of the command`,
    );
  }
  return ok({
    env: {},
    line: `dev profile: no base resolved (${resolved.error.detail}), so a diff gate this ${subject.kind} runs refuses rather than compares`,
  });
}

/**
 * The subject the flags name. Exactly one of `--gate`, `--lane` and `--verb` may be given.
 *
 * @param values the parsed flag values
 * @param tail the argv after `--`, which is `--verb`'s subject
 * @returns the subject, or the typed failure saying what was ambiguous or missing
 */
export function subjectFromFlags({
  values,
  tail,
}: {
  values: Readonly<Record<string, string | boolean>>;
  tail: readonly string[];
}): Result<ProfileSubject, ProfileSubjectError> {
  const gate = values["gate"];
  const lane = values["lane"];
  const verb = values["verb"] === true;
  const named = [typeof gate === "string", typeof lane === "string", verb].filter(Boolean).length;
  if (named === 0) {
    return err(ProfileSubjectErrors.noSubject());
  }
  if (named > 1) {
    return err(ProfileSubjectErrors.ambiguousSubject());
  }
  if (typeof gate === "string") {
    return ok({ kind: "gate", name: gate });
  }
  if (typeof lane === "string") {
    return ok({ kind: "lane", name: lane });
  }
  return ok({ argv: tail, kind: "verb" });
}

/** How many modules a report prints when `--top` is absent or unreadable. */
export const DEFAULT_TOP = 10;

/**
 * The `--top` value, defaulting when absent and refusing when it is not a positive integer.
 *
 * @param value the raw flag value
 * @returns the count to print
 */
export function parseTop({ value }: { value: string | boolean | undefined }): Result<number, ProfileSubjectError> {
  if (value === undefined || typeof value === "boolean") {
    return ok(DEFAULT_TOP);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return err(ProfileSubjectErrors.badNumericFlag({ flag: "--top", must: "a positive integer", value }));
  }
  return ok(parsed);
}

/**
 * The `--interval` value, or `undefined` to leave V8 on its own default.
 *
 * Refused below 100 µs rather than accepted: a sampler asked for a finer interval than it can honour spends
 * the run's time in the sampler, and the document it writes is the thing this verb then cannot parse.
 *
 * @param value the raw flag value
 * @returns the interval in microseconds, or `undefined` when the flag was absent
 */
export function parseInterval({
  value,
}: {
  value: string | boolean | undefined;
}): Result<number | undefined, ProfileSubjectError> {
  if (value === undefined || typeof value === "boolean") {
    return ok(undefined);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 100) {
    return err(
      ProfileSubjectErrors.badNumericFlag({
        flag: "--interval",
        must: "an integer of at least 100 microseconds",
        value,
      }),
    );
  }
  return ok(parsed);
}

/** What one `dev profile` invocation asked for, once every flag has been read. */
export interface ProfileRequest {
  readonly subject: ProfileSubject;
  /** How many module rows to print. */
  readonly top: number;
  /** V8's CPU sampling interval in microseconds, or `undefined` to leave V8 on its own default. */
  readonly intervalMicros: number | undefined;
}

/**
 * Every flag this verb reads, resolved together, refusing on the FIRST thing that is wrong.
 *
 * First rather than all of them: the three are independent, so a caller who mistyped `--top` has not also
 * mistyped the subject, and printing two complaints for one mistake is the shape that makes an operator
 * re-read the usage instead of the message. It also keeps the shell a straight-line read — the whole reason
 * this lives here rather than as three calls and three `isErr` branches at the call site.
 *
 * @param values the parsed flag values
 * @param tail the argv after `--`, which is `--verb`'s subject
 * @returns everything the run needs, or the first typed failure
 */
export function profileRequest({
  values,
  tail,
}: {
  values: Readonly<Record<string, string | boolean>>;
  tail: readonly string[];
}): Result<ProfileRequest, ProfileSubjectError> {
  const subject = subjectFromFlags({ tail, values });
  if (subject.isErr()) {
    return err(subject.error);
  }
  const top = parseTop({ value: values["top"] });
  if (top.isErr()) {
    return err(top.error);
  }
  const interval = parseInterval({ value: values["interval"] });
  if (interval.isErr()) {
    return err(interval.error);
  }
  return ok({ intervalMicros: interval.value, subject: subject.value, top: top.value });
}
