/**
 * The `codex plan` and `codex review` shells: read, run, persist, report. Every pure decision comes from
 * {@link ./core} and `src/codex/*`.
 *
 * Two entry points per verb, matching the repo's existing `runXWithDeps` convention: a deps-injected one
 * that tests drive with plain fakes against a temp home, and a thin production one that closes over the
 * real client, clock and filesystem.
 *
 * STDOUT CARRIES THE MACHINE RESULT; STDERR CARRIES EVERYTHING ELSE. `logger.out` writes the one JSON
 * document a caller parses; progress, warnings and errors go to stderr via `logger.error`/`info`. Mixing
 * them would put diagnostics in the middle of the document an agent has to read.
 */

import { makePassBound } from "../../../codex/bounds.js";
import { type LockedCodexClient } from "../../../codex/client.js";
import { refusalMessage } from "../../../codex/diff.js";
import { type ExactPassKey, planPassKey, reviewPassKey } from "../../../codex/duplicate.js";
import { capturePassTree, captureReviewDiffWithProvenance, type ReviewDiff } from "../../../codex/gitDiff.js";
import { type CompletedPass, runPlanPass, runReviewProperty } from "../../../codex/orchestrate.js";
import type { AdmittedPass } from "../../../codex/passAdmission.js";
import { type PassProfile, passProfile } from "../../../codex/profiles.js";
import type { CodexPassTree, PassBound, PlanPassId, ReviewProperty } from "../../../codex/types.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { admitFor } from "./admitFor.js";
import {
  type CodexPlanOptions,
  type CodexReviewOptions,
  PLAN_USAGE,
  parseCodexPlanOptions,
  parseCodexReviewOptions,
  REVIEW_USAGE,
} from "./core.js";
import { type CodexDeps, productionDeps, watchFor } from "./passDeps.js";
import { reportInvocations } from "./passReport.js";
import { admittedRoutedPass, fanOutAdmittedReview } from "./passRoute.js";
import { propertiesOrExit } from "./properties.js";
import { codexRepoRoot, repoDirOf } from "./repoScope.js";
import { reviewAnnounceLines } from "./reviewAnnounce.js";
import { refusedByReviewCap } from "./reviewCapGate.js";
import { readTaskFile } from "./taskFile.js";

/**
 * Where a `codex <verb>` flag tail begins in `process.argv`.
 *
 * `[node, cli, codex, plan, --pass, ...]` — so 4, matching `slack`'s `VERB_ARG_OFFSET`. Getting this wrong
 * leaves the VERB ITSELF in the flag tail, which the flag parser then rejects as an unexpected argument.
 * Unit tests that feed `rest` directly cannot catch it; only invoking the binary can, which is how this was
 * found.
 */
const VERB_ARG_OFFSET = 4;

/**
 * A plan pass's exact key, or `undefined` when the checkout moved while it was being read.
 *
 * `capturePassTree` is not itself atomic — it shells `git` for the fingerprint and again for the branch — so
 * a commit landing between those two calls yields a tree describing neither state. A Codex review
 * reproduced exactly that with real git commands and showed the consequence: the mixed key matched an older
 * record and refused a pass at a HEAD nothing had ever been run against.
 *
 * So the read is BRACKETED and must agree with itself. A disagreement returns no key at all, and a pass with
 * no key is never anyone's duplicate — the honest reading of "the tree moved while we looked" is that we
 * cannot say what this pass is, not that it is something in particular.
 *
 * @param pass which planning arm is about to run
 * @param repo the checkout to read
 * @returns the key, or undefined when the checkout could not be read consistently
 */
function stablePlanKey({ pass, repo }: { pass: PlanPassId; repo: string }): ExactPassKey | undefined {
  const before = capturePassTree({ cwd: repo });
  const after = capturePassTree({ cwd: repo });
  if (before === undefined || after === undefined) {
    return undefined;
  }
  if (before.headSha !== after.headSha || before.branch !== after.branch || before.fingerprint !== after.fingerprint) {
    return undefined;
  }
  return planPassKey({ branch: before.branch, headSha: before.headSha, pass });
}

/** Everything `codex plan` needs checked before it may spend, or the exit code to stop on. */
type PlanPreamble =
  | number
  | {
      readonly options: CodexPlanOptions;
      readonly bound: PassBound;
      readonly profile: PassProfile & { readonly mode: "plan" };
      readonly repo: string;
      readonly task: string;
    };

/**
 * Help, parse, bound, task file, repository and profile — every check `codex plan` makes before any spend.
 *
 * Split out for the same reason {@link reviewPreamble} was: the gate on function length is a gate on how much
 * a reader has to hold at once, and a verb whose body is six sequential refusals plus one call reads better
 * as "check, then run".
 *
 * @param argv the full process argv
 * @returns the checked inputs, or the exit code to return
 */
function planPreamble({ argv }: { argv: readonly string[] }): PlanPreamble {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: PLAN_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCodexPlanOptions({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((e) => {
      logger.error({ msg: e });
    });
    logger.error({ msg: PLAN_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const bound = makePassBound({ boundSeconds: options.boundSeconds });
  if (bound.isErr()) {
    logger.error({ msg: bound.error.message });
    return EXIT_USAGE;
  }
  const task = readTaskFile({ path: options.taskFile, verb: "codex plan" });
  if (typeof task === "number") {
    return task;
  }
  const repo = codexRepoRoot({ repo: options.repo });
  if (repo.isErr()) {
    logger.error({ msg: `not a git repository: ${repo.error.message}` });
    return EXIT_ERROR;
  }
  const profile = passProfile({ pass: options.pass });
  if (profile.mode !== "plan") {
    logger.error({ msg: "internal: a plan verb received a review profile" });
    return EXIT_USAGE;
  }
  return { bound: bound.value, options, profile, repo: repo.value, task };
}

/**
 * Run `codex plan` over injected dependencies.
 *
 * @param argv the full process argv (the verb tail starts at {@link VERB_ARG_OFFSET})
 * @param deps the client, clock and id seams
 * @returns the exit code
 */
export async function runCodexPlanWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: CodexDeps;
}): Promise<number> {
  const checked = planPreamble({ argv });
  if (typeof checked === "number") {
    return checked;
  }
  const { bound, options, profile, repo, task } = checked;
  const home = resolveHome({ named: options.home });
  const orchestrationRoot = stateHomePaths({ home }).orchestration;
  // Every argument the pass needs bar admission's proof and the client is read BEFORE admission, as main read
  // them, so no seam of this verb's own — the watcher, a getter on `deps` — runs between the last admission and
  // the pass's tree freeze (a Codex review found each one could move the tree there).
  const pass = {
    bound,
    orchestrationRoot,
    profile,
    repoRoot: repo,
    runtime: deps.runtime,
    task,
    ...(deps.newId !== undefined ? { newId: deps.newId } : {}),
    ...watchFor({ boundMs: bound.totalMs, deps, pass: options.pass }),
  };
  // Admitted, THEN routed: a duplicate plan never reads the fleet or builds a client.
  const invocation = await admittedRoutedPass({
    admit: admitFor({
      // The tree is captured INSIDE the admission callback, at the moment the pass asks — never before it.
      // A key built earlier names a HEAD the branch may have moved off, and refusing the pass at the new one
      // on the old one's record is a refusal of something that has not run (found by a Codex review). The
      // pass captures its own provenance separately at its real start, and THAT is what the artifact
      // records; these two reads must not be conflated.
      keyAt: () => stablePlanKey({ pass: profile.id, repo }),
      orchestrationRoot,
      repoRoot: repo,
    }),
    route: { bound, deps, home, model: options.model },
    run: ({ admitted, client }) => runPlanPass({ ...pass, admitted, client }),
  });
  return reportInvocations({ invocations: [invocation] });
}

/**
 * Help, parse and bound — the part both verbs share. Returns an exit code to stop on, or the checked inputs.
 */
function reviewPreamble({
  argv,
}: {
  argv: readonly string[];
}): { readonly options: CodexReviewOptions; readonly bound: PassBound } | number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: REVIEW_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCodexReviewOptions({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((e) => {
      logger.error({ msg: e });
    });
    logger.error({ msg: REVIEW_USAGE });
    return EXIT_USAGE;
  }
  const bound = makePassBound({ boundSeconds: parsed.value.boundSeconds });
  if (bound.isErr()) {
    logger.error({ msg: bound.error.message });
    return EXIT_USAGE;
  }
  return { bound: bound.value, options: parsed.value };
}

/**
 * Capture the diff AND the tree it came from, or return the exit code to stop on.
 *
 * Every refusal here happens BEFORE any model call, so nothing is spent on a question that could not have
 * been answered honestly.
 *
 * The tree is read ONCE, here, and handed unchanged to every property in the fan-out. It used to be read
 * inside each property's own pass, which is a different moment for every property past the concurrency cap
 * and therefore a different tree — see `captureReviewDiffWithProvenance` and `reviewPassProvenance`.
 */
function scopeTheDiff({ options }: { options: CodexReviewOptions }): ScopedDiff | number {
  const captured = captureReviewDiffWithProvenance({
    base: options.base,
    cwd: repoDirOf({ repo: options.repo }),
    maxBytes: options.maxDiffBytes,
  });
  if (captured.isErr()) {
    logger.error({ msg: `could not capture the review diff: ${captured.error.message}` });
    return EXIT_ERROR;
  }
  if (captured.value.capture.isErr()) {
    logger.error({ msg: refusalMessage({ refusal: captured.value.capture.error }) });
    return EXIT_USAGE;
  }
  return { diff: captured.value.capture.value, tree: captured.value.tree };
}

/** The diff a review will judge, and the tree it came from — one reading for the whole fan-out. */
interface ScopedDiff {
  readonly diff: ReviewDiff;
  /** `undefined` when the checkout moved while the diff was being read, so no single tree describes it. */
  readonly tree: CodexPassTree | undefined;
}

/**
 * Run `codex review` over injected dependencies.
 *
 * @param argv the full process argv (the verb tail starts at {@link VERB_ARG_OFFSET})
 * @param deps the client, clock and id seams
 * @returns the exit code
 */
export async function runCodexReviewWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: CodexDeps;
}): Promise<number> {
  const preamble = reviewPreamble({ argv });
  if (typeof preamble === "number") {
    return preamble;
  }
  const { options, bound } = preamble;
  const scoped = scopeTheDiff({ options });
  if (typeof scoped === "number") {
    return scoped;
  }
  const profile = passProfile({ pass: options.pass });
  if (profile.mode !== "review") {
    logger.error({ msg: "internal: a review verb received a plan profile" });
    return EXIT_USAGE;
  }
  const properties = propertiesOrExit({ options });
  if (typeof properties === "number") {
    return properties;
  }
  const home = resolveHome({ named: options.home });
  const orchestrationRoot = stateHomePaths({ home }).orchestration;
  if (await refusedBeforeSpend({ deps, home, options, properties, scoped })) {
    return EXIT_ERROR;
  }
  // Each property is its OWN bounded call against the BYTE-IDENTICAL diff, so the verdicts are comparable
  // and one property failing cannot erase a sibling's artifact — and each is admitted, then routed, when its
  // own slot opens, so no property spends on a fleet reading taken before it started.
  const passes = await fanOutAdmittedReview({
    // A constant key: the diff was frozen before the fan-out started, so this key cannot go stale.
    admitOf: ({ property }) =>
      admitFor({
        keyAt: () => reviewPassKey({ diffSha256: scoped.diff.sha256, pass: profile.id, propertyId: property.id }),
        orchestrationRoot,
        repoRoot: scoped.diff.repoRoot,
      }),
    concurrency: options.concurrency,
    properties,
    route: { bound, deps, home, model: options.model },
    run: ({ admitted, client, property }) =>
      runOneProperty({ admitted, bound, client, deps, options, orchestrationRoot, profile, property, scoped }),
  });
  return reportInvocations({ invocations: passes });
}

/**
 * What runs before anything is spent: the two-pass cap, then the announce lines.
 *
 * A third review pass is refused here, whichever destination would have taken it. The announce runs before
 * routing, so a chase is read even when every destination is capped and the review goes to Claude.
 *
 * @returns true when the cap refused the review and nothing may run
 */
async function refusedBeforeSpend({
  deps,
  home,
  options,
  properties,
  scoped,
}: {
  deps: CodexDeps;
  home: string;
  options: { readonly concurrency: number };
  properties: readonly { readonly id: string }[];
  scoped: ScopedDiff;
}): Promise<boolean> {
  const branch = scoped.tree?.branch;
  const { fallbackPort, supersessions } = deps;
  const diff = scoped.diff;
  const verb = "codex review";
  if (await refusedByReviewCap({ branch, diff, env: process.env, fallbackPort, home, supersessions, verb })) {
    return true;
  }
  for (const line of await reviewAnnounceLines({
    branch,
    concurrency: options.concurrency,
    count: properties.length,
    diff,
    fallbackPort,
    home,
    propertyIds: properties.map((property) => property.id),
    supersessions,
  })) {
    logger.info({ msg: line });
  }
  return false;
}

/** One admitted, routed property's own bounded review call, against the diff the fan-out froze before it started. */
async function runOneProperty({
  admitted,
  bound,
  client,
  deps,
  options,
  orchestrationRoot,
  profile,
  property,
  scoped: { diff, tree },
}: {
  admitted: AdmittedPass;
  bound: PassBound;
  client: LockedCodexClient;
  deps: CodexDeps;
  options: CodexReviewOptions;
  orchestrationRoot: string;
  profile: PassProfile & { readonly mode: "review" };
  property: ReviewProperty;
  scoped: ScopedDiff;
}): Promise<CompletedPass> {
  return runReviewProperty({
    admitted,
    baseRef: options.base,
    bound,
    client,
    diff,
    diffTree: tree,
    orchestrationRoot,
    profile,
    property,
    runtime: deps.runtime,
    ...(deps.newId !== undefined ? { newId: deps.newId } : {}),
    ...watchFor({ boundMs: bound.totalMs, deps, pass: options.pass }),
  });
}

/**
 * Run `codex plan`.
 *
 * @param argv the full process argv
 * @returns the exit code
 */
export async function runCodexPlan(argv: readonly string[]): Promise<number> {
  return runCodexPlanWithDeps({ argv, deps: productionDeps() });
}

/**
 * Run `codex review`.
 *
 * @param argv the full process argv
 * @returns the exit code
 */
export async function runCodexReview(argv: readonly string[]): Promise<number> {
  return runCodexReviewWithDeps({ argv, deps: productionDeps() });
}

export const codexPlanCommand = defineCommand({ run: runCodexPlan });

export const codexReviewCommand = defineCommand({ run: runCodexReview });
