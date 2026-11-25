/**
 * Assembling a pass: prompt → bounded turns → record → artifact. The effectful shell over the pure core.
 *
 * A review of N properties runs each as its OWN pass — its own prompt, its own bound, its own thread, its
 * own artifact — fanned out through `createConcurrencyLimiter` (p-limit) from `src/lib/resilience.ts`. A
 * bespoke worker pool here would fail the `resilience-residue` gate, and rightly: the repo already owns
 * that primitive.
 *
 * The fan-out shape is the measured one. Five reviewers on five properties is the INTENDED shape of a
 * review, not an edge case: one call packing ~25 checks ran 1h50m across 115 exec calls and never
 * converged, because N properties in one call have no joint stopping condition. Each property here gets a
 * separate process-level question with its own conclusion, and one property failing does not erase its
 * siblings' artifacts.
 */

import { randomUUID } from "node:crypto";
import type { IngestError } from "../lib/ingestError.js";
import { createConcurrencyLimiter } from "../lib/resilience.js";
import type { Result } from "../lib/result.js";
import { createPassScratch, writePassDiff } from "./artifactStore.js";
import type { LockedCodexClient } from "./client.js";
import { scratchUnavailable } from "./fatalOutcome.js";
import { capturePassTree, type ReviewDiff } from "./gitDiff.js";
import { PLAN_OUTPUT_SCHEMA, parsePlanAnswer, parseReviewAnswer, REVIEW_OUTPUT_SCHEMA } from "./output.js";
import type { AdmittedPass } from "./passAdmission.js";
import { type CompletedPass, persistPass } from "./passPersist.js";
import { reviewPassProvenance, stableTree, withSnapshotCommit } from "./passProvenance.js";
import { planScope, reviewScope } from "./passRecord.js";
import { runReviewPassWithPolicyRetry } from "./policyRetryPass.js";
import type { PassProfile } from "./profiles.js";
import { buildPlanPrompt, buildReviewPrompt } from "./prompt.js";
import { type BoundedPassResult, type DeadlineRuntime, runBoundedPass } from "./runPass.js";
import { captureContentTree, type TreeSnapshot } from "./snapshot.js";
import { freezeForPass } from "./snapshotPool.js";
import type { CodexEventSink, CodexPassTree, PassBound, ReviewAnswer, ReviewProperty } from "./types.js";

export type { CompletedPass } from "./passPersist.js";

/**
 * Git's content address of the LIVE tree — the third reading {@link stableTree} needs the other half of.
 *
 * The snapshot's half comes free off {@link TreeSnapshot.contentTree}, which is a byproduct of a `write-tree`
 * that already succeeded, so only this half can fail. It returns `undefined` when there is no snapshot,
 * because then there is no third reading to take at all; a snapshot that EXISTS whose live counterpart could
 * not be read is a DISAGREEMENT rather than an absence of opinion, and {@link stableTree} is where that is
 * decided.
 *
 * @param repoRoot the live checkout to address
 * @param snapshot the frozen copy, or undefined when none was made
 * @returns the live content tree, or undefined when there is no snapshot or git refused
 */
function liveContentTreeOf({
  repoRoot,
  snapshot,
}: {
  repoRoot: string;
  snapshot: TreeSnapshot | undefined;
}): string | undefined {
  if (snapshot === undefined) {
    return undefined;
  }
  const captured = captureContentTree({ repoRoot });
  return captured.isOk() ? captured.value : undefined;
}

/**
 * Freeze the tree and establish what the pass will actually read — the two halves that must not be separated.
 *
 * Provenance BRACKETS the freeze, and that is a correction. The capture used to follow it, so a writer
 * advancing the checkout in between left the record naming a commit the pass never read — and because a plan
 * record's duplicate key IS its head, a later pass at that head was refused as an exact duplicate of a verdict
 * computed over different code. A Codex review reproduced it with a post-checkout hook, then a second one
 * showed two agreeing endpoints still prove nothing about the middle, which is why git's content address of
 * what the copy HOLDS is a third reading ({@link stableTree}). When the readings disagree the tree is recorded as UNCAPTURED
 * rather than as either head: `recordPassKey` cannot key a record with no tree, so an ambiguous pass can
 * never be anyone's duplicate.
 *
 * @param repoRoot the checkout to freeze
 * @internal exported for `subprocess/codex/freezeProvenance.test.ts` — the COMPOSITION is what broke, not
 *   either half: a working content-tree comparison wired to the wrong reading records nothing, and only real
 *   git over a real dirty repository says whether these three readings are taken of the same thing.
 * @returns the frozen copy (or undefined), the root the pass should read, and the provenance to record
 */
export function freezeWithProvenance({ repoRoot }: { repoRoot: string }): {
  readonly frozen: TreeSnapshot | undefined;
  readonly readRoot: string;
  readonly tree: CodexPassTree | undefined;
} {
  const before = capturePassTree({ cwd: repoRoot });
  const frozen = freezeForPass({ repoRoot });
  const stable = stableTree({
    after: capturePassTree({ cwd: repoRoot }),
    before,
    liveContentTree: liveContentTreeOf({ repoRoot, snapshot: frozen }),
    snapshotContentTree: frozen?.contentTree,
  });
  return {
    frozen,
    readRoot: frozen?.path ?? repoRoot,
    tree: withSnapshotCommit({ captured: stable, snapshotCommit: frozen?.commit }),
  };
}

/** Run the bounded pass itself, releasing the frozen snapshot however it exits — answer, timeout, or throw. */
async function runPlanTurn({
  bound,
  client,
  frozen,
  onEvent,
  prompt,
  readRoot,
  runtime,
  scratch,
}: {
  bound: PassBound;
  client: LockedCodexClient;
  frozen: TreeSnapshot | undefined;
  onEvent: CodexEventSink | undefined;
  prompt: string;
  readRoot: string;
  runtime: DeadlineRuntime;
  scratch: Result<string, IngestError>;
}): Promise<BoundedPassResult> {
  try {
    return scratch.isErr()
      ? scratchUnavailable({ error: scratch.error })
      : await runBoundedPass({
          bound,
          client,
          onEvent,
          outputSchema: PLAN_OUTPUT_SCHEMA,
          prompt,
          repoRoot: readRoot,
          runtime,
          validate: parsePlanAnswer,
          workingDirectory: scratch.value,
        });
  } finally {
    frozen?.release();
  }
}

/**
 * Run one planning pass (p1/p2/p3) and persist its artifact.
 *
 * Takes ALREADY ADMITTED, ALREADY ROUTED work: the client is the routed destination's, built after the
 * duplicate gate let this pass through, so no route can be taken for a pass admission would refuse. The
 * `admitted` field enforces it — only `admittedPass` mints one, and never for a duplicate.
 *
 * @param admitted admission's proof this pass may run, never bound: its presence is the guarantee
 * @param client the locked Codex client for the destination this pass was routed to
 * @param profile the plan pass profile
 * @param task the task description being planned
 * @param bound the explicit bound
 * @param repoRoot the repository the pass reads
 * @param runtime the clock/timer seam
 * @param orchestrationRoot `$SLOPWEAVER_HOME/orchestration`
 * @param reclaimLedgerPath the reclaim ledger the pass journals its own scratch's removal into
 * @param newId an id generator (injected so tests are deterministic)
 * @param onEvent receives each step of the pass as it happens; omit to run blind
 * @returns the completed pass
 */
export async function runPlanPass({
  client,
  profile,
  task,
  bound,
  repoRoot,
  runtime,
  orchestrationRoot,
  reclaimLedgerPath,
  onEvent,
  newId = () => randomUUID(),
}: {
  admitted: AdmittedPass;
  client: LockedCodexClient;
  profile: PassProfile & { readonly mode: "plan" };
  task: string;
  bound: PassBound;
  repoRoot: string;
  runtime: DeadlineRuntime;
  orchestrationRoot: string;
  reclaimLedgerPath: string;
  /** Receives each step of the pass as it happens. Omit to run blind. */
  onEvent?: CodexEventSink | undefined;
  newId?: () => string;
}): Promise<CompletedPass> {
  const artifactId = newId();
  // The workspace is a scratch directory, NOT the repository. That is the entire write boundary: the sandbox
  // permits writes inside the working directory, so pointing it away from the repo is what stops Codex and
  // the code-writing agent treading on each other. A failure here is fatal rather than degraded — running
  // the pass with the repo as its workspace would silently hand back exactly that write access.
  const scratch = createPassScratch({ artifactId, orchestrationRoot });
  const { frozen, readRoot, tree } = freezeWithProvenance({ repoRoot });
  const prompt = buildPlanPrompt({ profile, repoRoot: readRoot, task });
  const passResult = await runPlanTurn({ bound, client, frozen, onEvent, prompt, readRoot, runtime, scratch });
  const scope = planScope({ profile, prompt });
  return persistPass({
    fields: {
      artifactId,
      bound,
      passResult,
      repoRoot,
      requestedModel: client.model,
      runtime,
      scope,
      tree,
      workspace: scratch.isErr() ? null : scratch.value,
    },
    orchestrationRoot,
    reclaimLedgerPath,
  });
}

/** The review prompt's arguments, gathered in one place so the turn stays a thin sequence. Pure. */
function reviewPrompt({
  diff,
  diffPath,
  profile,
  property,
  repoRoot,
}: {
  diff: ReviewDiff;
  diffPath: string;
  profile: PassProfile;
  property: ReviewProperty;
  repoRoot: string;
}): string {
  return buildReviewPrompt({
    diffBytes: diff.bytes,
    diffPath,
    diffSha256: diff.sha256,
    profile,
    property,
    repoRoot,
  });
}

async function runReviewTurn({
  artifactId,
  bound,
  client,
  diff,
  onEvent,
  orchestrationRoot,
  profile,
  property,
  runtime,
  validate,
}: {
  artifactId: string;
  bound: PassBound;
  client: LockedCodexClient;
  diff: ReviewDiff;
  onEvent?: CodexEventSink | undefined;
  orchestrationRoot: string;
  profile: PassProfile;
  property: ReviewProperty;
  runtime: DeadlineRuntime;
  validate: (args: { response: string }) => Result<ReviewAnswer>;
}): Promise<{
  readonly passResult: BoundedPassResult;
  readonly workspace: string | null;
  readonly snapshotCommit: string | undefined;
}> {
  const scratch = createPassScratch({ artifactId, orchestrationRoot });
  if (scratch.isErr()) {
    return { passResult: scratchUnavailable({ error: scratch.error }), snapshotCommit: undefined, workspace: null };
  }
  const diffFile = writePassDiff({ diff: diff.text, property, scratch: scratch.value });
  if (diffFile.isErr()) {
    return { passResult: scratchUnavailable({ error: diffFile.error }), snapshotCommit: undefined, workspace: null };
  }
  // The diff is already frozen — it is text in a file. The SURROUNDING code is not, and a review that reads
  // beyond its diff (a caller, whether a helper already exists) is reading a tree the agent may be editing.
  // So the review arm gets the same frozen copy as the planning arm — taken when THIS PROPERTY'S slot opens,
  // which is why it is recorded as `snapshotCommit` and is NOT the record's `tree` (`reviewPassProvenance`).
  const frozen = freezeForPass({ repoRoot: diff.repoRoot });
  const readRoot = frozen?.path ?? diff.repoRoot;
  // A review, and only a review, earns one fresh thread after OpenAI's `cyber-policy` refusal: every refusal
  // measured was a review. The frozen copy is released only once both threads have settled.
  const passResult = await runReviewPassWithPolicyRetry({
    bound,
    client,
    onEvent,
    outputSchema: REVIEW_OUTPUT_SCHEMA,
    prompt: reviewPrompt({ diff, diffPath: diffFile.value, profile, property, repoRoot: readRoot }),
    repoRoot: readRoot,
    runtime,
    validate,
    workingDirectory: scratch.value,
  }).finally(() => frozen?.release());
  return { passResult, snapshotCommit: frozen?.commit, workspace: scratch.value };
}

/**
 * Run ONE review property as its own pass and persist its artifact.
 *
 * Takes ALREADY ADMITTED, ALREADY ROUTED work, exactly as {@link runPlanPass} does: the fan-out admits and
 * routes each property when its own slot opens, then hands this the client that property was routed to.
 *
 * @param admitted admission's proof this property may run, never bound: its presence is the guarantee
 * @param client the locked Codex client for the destination this property was routed to
 * @param profile the review pass profile
 * @param property the single falsifiable claim
 * @param diff the captured diff, supplied byte-identically to every property
 * @param diffTree the tree the DIFF came from, captured once for the whole fan-out and shared by every
 *   property. Never re-read here, which is the whole point — see {@link reviewPassProvenance}.
 * @param baseRef the base ref the diff came from
 * @param bound the explicit bound
 * @param runtime the clock/timer seam
 * @param orchestrationRoot `$SLOPWEAVER_HOME/orchestration`
 * @param reclaimLedgerPath the reclaim ledger the pass journals its own scratch's removal into
 * @param newId an id generator
 * @param onEvent receives each step of the pass as it happens; omit to run blind
 * @returns the completed pass
 */
export async function runReviewProperty({
  client,
  profile,
  property,
  diff,
  diffTree,
  baseRef,
  bound,
  runtime,
  orchestrationRoot,
  reclaimLedgerPath,
  onEvent,
  newId = () => randomUUID(),
}: {
  admitted: AdmittedPass;
  client: LockedCodexClient;
  profile: PassProfile & { readonly mode: "review" };
  property: ReviewProperty;
  diff: ReviewDiff;
  diffTree: CodexPassTree | undefined;
  baseRef: string;
  bound: PassBound;
  runtime: DeadlineRuntime;
  orchestrationRoot: string;
  reclaimLedgerPath: string;
  /** Receives each step of the pass as it happens. Omit to run blind. */
  onEvent?: CodexEventSink | undefined;
  newId?: () => string;
}): Promise<CompletedPass> {
  const artifactId = newId();
  const turn = await runReviewTurn({
    artifactId,
    bound,
    client,
    diff,
    onEvent,
    orchestrationRoot,
    profile,
    property,
    runtime,
    validate: ({ response }) => parseReviewAnswer({ property, response }),
  });
  return persistPass({
    fields: {
      artifactId,
      bound,
      passResult: turn.passResult,
      repoRoot: diff.repoRoot,
      requestedModel: client.model,
      runtime,
      scope: reviewScope({ baseRef, diff, profile, property }),
      tree: reviewPassProvenance({ diffTree, snapshotCommit: turn.snapshotCommit }),
      workspace: turn.workspace,
    },
    orchestrationRoot,
    reclaimLedgerPath,
  });
}

/**
 * Fan out a review across N properties, one bounded pass each, capped by an explicit concurrency.
 *
 * Every property receives the BYTE-IDENTICAL diff, so their verdicts are comparable and the artifact's
 * `diffSha256` means the same thing in each. `runOne` is called only once that property's slot OPENS, which
 * is where the CLI admits and then routes it — so a property queued behind others sees what they published
 * and is routed on the fleet as it stands when it starts, never on a reading taken before the fan-out.
 *
 * @param properties the falsifiable claims, one per pass
 * @param concurrency the explicit parallelism cap (no default — the caller chooses)
 * @param runOne how to admit, route and run a single property (injected so the fan-out is testable without a client)
 * @returns every property's outcome, in the order the properties were given
 */
export async function fanOutReview<Outcome>({
  properties,
  concurrency,
  runOne,
}: {
  properties: readonly ReviewProperty[];
  concurrency: number;
  runOne: (args: { property: ReviewProperty }) => Promise<Outcome>;
}): Promise<readonly Outcome[]> {
  const limit = createConcurrencyLimiter({ concurrency });
  return Promise.all(properties.map((property) => limit(() => runOne({ property }))));
}
