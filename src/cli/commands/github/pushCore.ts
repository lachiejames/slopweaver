/**
 * `slopweaver github push` — the pure decisions behind a governed branch push.
 *
 * The verb deliberately cannot express an arbitrary refspec. It pushes the checked-out branch to the
 * same-named branch on one configured remote, refuses the remote's default branch, and turns
 * `--force-with-lease` into an EXACT lease against the SHA read from that remote immediately beforehand.
 * The effectful shell in `./pushRun.ts` performs and verifies the write through the admit door.
 */
import type { GithubPushFacts, GithubPushPlan } from "../../../admit/githubPush.js";
import type { DoorRequest } from "../../../admit/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type BaseFreshnessAcknowledgement, baseFreshnessAcknowledgementFrom } from "./baseFreshnessCore.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";
import { ORPHAN_ABOVE_FLAG, parseOrphanAbove } from "./stackCarryCore.js";
import { remoteFlag } from "./stackCommonArgs.js";

/** The flags this verb accepts; the help-truth ratchet reads the names derived from it below. */
const GITHUB_PUSH_FLAGS: FlagSpec = {
  boolean: ["dry-run", "force-with-lease", "acknowledge-all"],
  string: ["cwd", "remote", "self-review", "home", "acknowledge", "reason", ORPHAN_ABOVE_FLAG],
};

/** Every accepted flag, with the `--` callers type. */
export const GITHUB_PUSH_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_PUSH_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_PUSH_FLAGS }),
].map((name) => `--${name}`);

/** The parsed, side-effect-free invocation. */
export interface GithubPushArgs {
  readonly cwd: string | undefined;
  readonly remote: string;
  readonly home: string | undefined;
  readonly dryRun: boolean;
  readonly forceWithLease: boolean;
  readonly selfReviewSource: string | undefined;
  readonly baseFreshnessAcknowledgement: BaseFreshnessAcknowledgement;
  /**
   * The pull requests stacked above this branch whose orphaning the caller deliberately accepts — the carry
   * gate's break-glass, empty for every ordinary push. See `./stackCarryCore.ts` for why it is exact.
   */
  readonly orphanAbove: readonly number[];
}

/**
 * The acknowledgement for a caller that never checks base freshness at all — `stack adopt`/`push`/`sync`
 * build a plan through this pure function but never route it through `runGithubPush`'s freshness gate, so
 * this value is never actually consulted; it exists only so those call sites can satisfy the type.
 */
export const NO_BASE_FRESHNESS_ACKNOWLEDGEMENT: BaseFreshnessAcknowledgement = {
  acknowledge: [],
  acknowledgeAll: false,
  reason: undefined,
};

/**
 * The acknowledgement for a plan built INSIDE a carry — the carry is the thing that keeps a stack whole, so
 * a step of one can never itself be asked to accept orphaning something. Exists so those call sites satisfy
 * {@link GithubPushArgs} without spelling an empty array that reads as an oversight.
 */
export const NO_ORPHANS_ACCEPTED: readonly number[] = [];

/** One optional string flag. */
function stringFlag({
  values,
  name,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
}): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Parse a push invocation without touching Git or the network.
 *
 * @param argv the verb's own argument tail, after `github push`
 * @returns the parsed options or every usage error
 */
export function parseGithubPushArgs({ argv }: { argv: readonly string[] }): Result<GithubPushArgs> {
  const parsed = parseFlags({ args: argv, spec: GITHUB_PUSH_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const remote = remoteFlag({ values });
  const errors: string[] = [];
  if (remote.trim().length === 0) {
    errors.push("--remote must not be blank");
  }
  const baseFreshnessAcknowledgement = baseFreshnessAcknowledgementFrom({ enabled: true, errors, values });
  const orphanAbove = parseOrphanAbove({ errors, raw: stringFlag({ name: ORPHAN_ABOVE_FLAG, values }) });
  if (errors.length > 0) {
    return err(errors);
  }
  return ok({
    baseFreshnessAcknowledgement,
    cwd: stringFlag({ name: "cwd", values }),
    dryRun: values["dry-run"] === true,
    forceWithLease: values["force-with-lease"] === true,
    home: stringFlag({ name: "home", values }),
    orphanAbove,
    remote,
    selfReviewSource: stringFlag({ name: "self-review", values }),
  });
}

/*
 * `githubRepoFromRemote` moved to `src/lib/githubRemote.ts`, where the admit layer's old-history push guard can
 * reach it too; it is re-exported here so the push and stack verbs keep their import.
 */
export { githubRepoFromRemote } from "#lib/githubRemote.js";

/**
 * Parse `git ls-remote --symref` output for the remote default and target branch.
 *
 * @param text the exact stdout from `git ls-remote --symref <remote> HEAD refs/heads/<branch>`
 * @param branch the checked-out branch being inspected
 * @returns both remote facts, refusing an unreported default branch
 */
export function parseRemoteSnapshot({
  text,
  branch,
}: {
  text: string;
  branch: string;
}): GithubVerbResult<{ readonly defaultBranch: string; readonly branchSha: string | undefined }> {
  const lines = text.split("\n").filter((line) => line.length > 0);
  const defaultLine = lines.find((line) => line.startsWith("ref: refs/heads/") && line.endsWith("\tHEAD"));
  if (defaultLine === undefined) {
    return err(GithubVerbErrors.remoteDefaultUnreported());
  }
  const defaultBranch = defaultLine.slice("ref: refs/heads/".length, -"\tHEAD".length);
  const branchRef = `refs/heads/${branch}`;
  const branchLine = lines.find((line) => line.endsWith(`\t${branchRef}`));
  const candidate = branchLine?.split("\t")[0];
  if (candidate !== undefined && !/^[0-9a-f]{40,64}$/.test(candidate)) {
    return err(GithubVerbErrors.remoteShaInvalid({ ref: branchRef }));
  }
  const branchSha = candidate;
  return ok({ branchSha, defaultBranch });
}

/** Exact lease flag, including an empty expected SHA when the remote branch does not yet exist. */
function leaseFlag({ branch, remoteBranchSha }: { branch: string; remoteBranchSha: string | undefined }): string {
  if (remoteBranchSha === undefined) {
    return `--force-with-lease=refs/heads/${branch}:`;
  }
  return `--force-with-lease=refs/heads/${branch}:${remoteBranchSha}`;
}

/**
 * Build the only push argv this command permits.
 *
 * @param args the parsed caller options
 * @param facts the live repository and remote facts
 * @returns a push plan, or the safety reason it was refused
 */
export function githubPushPlan({
  args,
  facts,
}: {
  args: GithubPushArgs;
  facts: GithubPushFacts;
}): GithubVerbResult<GithubPushPlan> {
  if (facts.branch === facts.defaultBranch) {
    return err(GithubVerbErrors.pushDefaultBranch({ defaultBranch: facts.defaultBranch }));
  }
  const lease = args.forceWithLease
    ? [leaseFlag({ branch: facts.branch, remoteBranchSha: facts.remoteBranchSha })]
    : [];
  return ok({
    ...facts,
    forceWithLease: args.forceWithLease,
    // The exact-lease flag above already pins the DESTINATION to a known-good expected SHA; this pins the
    // SOURCE to the exact commit the caller measured (`facts.localSha`), not `HEAD` — a plain `HEAD` source
    // would push whatever the branch happens to point at when this command actually runs, which can differ
    // from what was measured and shown to the caller if anything else moves the branch in between (a real,
    // live-probed race: an external git process — an editor, a hook — moving the checked-out branch after
    // planning but before this push still executes cleanly under a valid lease, silently pushing the wrong
    // commit). `^{commit}` is load-bearing, not decoration: a bare 40-hex SHA in a push refspec's source
    // resolves to a LOCAL BRANCH of that exact name before it falls back to the object id — live-confirmed
    // against a real repository, where an attacker-controlled (or just coincidentally shaped) branch name
    // silently redirected the push to that branch's tip instead of `facts.localSha`. The suffix forces
    // object resolution, which cannot be shadowed this way.
    gitArgs: ["push", "--set-upstream", ...lease, args.remote, `${facts.localSha}^{commit}:refs/heads/${facts.branch}`],
    purpose: "pull-request-head",
    remote: args.remote,
  });
}

/** The remote SHA the door ledger records: JSON `null` for a branch the remote does not have yet. */
function ledgerRemoteSha({ plan }: { plan: GithubPushPlan }): string | null {
  const remoteSha = plan.remoteBranchSha;
  if (remoteSha === undefined) {
    return null;
  }
  return remoteSha;
}

/**
 * The directory a verb stands in. No `--cwd` is a supported invocation, not a missing value: the verb stands
 * where it was run.
 *
 * @param cwd the `--cwd` the operator passed, if any
 * @returns that directory, or the process's own working directory when none was passed
 */
export function invocationDir({ cwd }: { cwd: string | undefined }): string {
  if (cwd === undefined) {
    return process.cwd();
  }
  return cwd;
}

/**
 * The directory a push measures from — {@link invocationDir}'s injectable twin, for a driver whose deps say
 * where the process stands.
 *
 * @param args the invocation, read for `cwd` only
 * @param deps the injectable working-directory edge
 * @returns the named directory, or the deps' own working directory when none was named
 */
export function pushStandingDir({
  args,
  deps,
}: {
  args: { readonly cwd?: string | undefined };
  deps: { readonly cwd: () => string };
}): string {
  const named = args.cwd;
  if (named === undefined) {
    return deps.cwd();
  }
  return named;
}

/**
 * Describe the external write to the admit door without recording a credential-bearing remote URL.
 *
 * @param home the state home whose door ledger records the attempt
 * @param plan the exact push plan being admitted
 * @returns the external-write door request
 */
export function githubPushDoorRequest({ home, plan }: { home: string; plan: GithubPushPlan }): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "push" },
    artifact: {
      branch: plan.branch,
      forceWithLease: plan.forceWithLease,
      localSha: plan.localSha,
      remote: plan.remote,
      remoteBranchSha: ledgerRemoteSha({ plan }),
      repo: plan.repo,
    },
    meta: {
      createsWorkItem: false,
      effect: "external-write",
      home,
      requiresApproval: false,
    },
  };
}
