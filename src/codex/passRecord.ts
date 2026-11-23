import { LOCKED_POLICY } from "./client.js";
import { diffSha256 } from "./diff.js";
import type { ReviewDiff } from "./gitDiff.js";
import { CODEX_REASONING_EFFORT, type PlanPassProfile, type ReviewPassProfile } from "./profiles.js";
import type { BoundedPassResult, DeadlineRuntime } from "./runPass.js";
import type { CodexArtifactRecord, CodexPassScope, CodexPassTree, PassBound, ReviewProperty } from "./types.js";

/**
 * What a planning pass was pointed at. Pure, so the provenance can be asserted without running a pass.
 *
 * @param profile the pass profile (supplies the pass id)
 * @param prompt the exact prompt text sent
 * @returns the plan-mode scope
 */
export function planScope({ profile, prompt }: { profile: PlanPassProfile; prompt: string }): CodexPassScope {
  return {
    mode: "plan",
    pass: profile.id,
    promptBytes: Buffer.byteLength(prompt, "utf8"),
    promptSha256: diffSha256({ diff: prompt }),
  };
}

/**
 * What a review pass judged — enough to prove WHICH diff produced the verdict. Pure.
 *
 * @param baseRef the base ref the diff was taken against
 * @param diff the captured review diff
 * @param profile the pass profile (supplies the pass id)
 * @param property the single falsifiable property under review
 * @returns the review-mode scope
 */
export function reviewScope({
  baseRef,
  diff,
  profile,
  property,
}: {
  baseRef: string;
  diff: ReviewDiff;
  profile: ReviewPassProfile;
  property: ReviewProperty;
}): CodexPassScope {
  return {
    baseRef,
    baseSha: diff.baseSha,
    diffBytes: diff.bytes,
    diffSha256: diff.sha256,
    headSha: diff.headSha,
    mode: "review",
    pass: profile.id,
    property,
  };
}

/**
 * Assemble the artifact record. Separated from persistence so the disclosure can be asserted without
 * writing a file, which is what makes the policy fields testable rather than merely reviewed.
 *
 * @param artifactId the pass id
 * @param bound the requested bound
 * @param passResult the completed pass
 * @param repoRoot the repository the pass was pointed at
 * @param requestedModel the model the pass's client asked for — read off the client, never retyped
 * @param runtime supplies the clock
 * @param scope what the pass was pointed at
 * @param tree the tree at pass start, or `undefined` when it could not be determined
 * @param workspace the scratch directory prepared for the pass, or `null` when none was
 * @returns the record to write
 */
export function toArtifactRecord({
  artifactId,
  bound,
  passResult,
  repoRoot,
  requestedModel,
  runtime,
  scope,
  tree,
  workspace,
}: {
  artifactId: string;
  bound: PassBound;
  passResult: BoundedPassResult;
  repoRoot: string;
  requestedModel: string;
  runtime: DeadlineRuntime;
  scope: CodexPassScope;
  tree: CodexPassTree | undefined;
  /**
   * The workspace PREPARED for the pass, as `createPassScratch` resolved it — never rebuilt here.
   *
   * Rebuilding it was a real defect: this reconstructed the path by string interpolation while
   * `createPassScratch` built it with `join`, so a non-normalised `orchestrationRoot` produced a disclosed
   * root that named a different directory from the one written to. A disclosure that can drift from the
   * thing it discloses is worse than none.
   *
   * "Prepared", not "used", and the distinction is deliberate: a thread can still fail to start after the
   * directory exists, in which case nothing was ever written there. Claiming it was USED would overstate.
   * Whether a turn ran at all is a separate fact the reader already has, in the attempts below.
   * `null` when the directory could not be created, so there was no workspace at all.
   */
  workspace: string | null;
}): CodexArtifactRecord {
  const policy = LOCKED_POLICY;
  return {
    artifactId,
    attempts: passResult.attempts,
    bound,
    createdAtIso: runtime.nowIso(),
    observedElapsedMs: passResult.observedElapsedMs,
    outcome: passResult.outcome,
    repoRoot,
    // DERIVED, never retyped. These were duplicated literals, so changing the policy in `client.ts` left the
    // artifact confidently reporting the old one — a disclosure that lies is worse than no disclosure.
    requestedApprovalPolicy: policy.approvalPolicy,
    requestedModel,
    requestedNetworkAccess: policy.networkAccessEnabled,
    requestedReasoningEffort: CODEX_REASONING_EFFORT,
    requestedSandboxMode: policy.sandboxMode,
    requestedWebSearch: policy.webSearchEnabled,
    requestedWritableRoots: workspace === null ? [] : [workspace, ...policy.additionalDirectories],
    schemaVersion: 1,
    scope,
    ...(tree === undefined ? {} : { tree }),
  };
}
