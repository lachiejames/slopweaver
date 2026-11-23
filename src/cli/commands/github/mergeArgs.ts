/**
 * `slopweaver github merge` — parsing this verb's arguments. Pure: every decision the verb makes about what it
 * was asked lives here, and every decision about the measured diff lives in `./mergeCore.js`.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";

/** How many removed lines, by default, make a modified-but-unnamed file its own finding. See `--deletion-threshold`. */
const DEFAULT_DELETION_THRESHOLD = 40;

/**
 * The flags this verb accepts.
 *
 * `helpTruth.test.ts` compares the names derived from it below against the manifest usage string in both
 * directions, and pushes them through the REAL parser rather than a restated copy of it.
 */
const GITHUB_MERGE_FLAGS: FlagSpec = {
  boolean: ["acknowledge-all", "admin", "dry-run"],
  string: [
    "repo",
    "cwd",
    "base",
    "head",
    "description",
    "deletion-threshold",
    "acknowledge",
    "reason",
    "home",
    "number",
    "remote",
  ],
};

/** The Git remote a `--admin` merge remeasures base freshness against when `--remote` is absent. */
const DEFAULT_MERGE_REMOTE = "origin";

/** Every accepted flag, WITH the `--`, for the help-truth ratchet. */
export const GITHUB_MERGE_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_MERGE_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_MERGE_FLAGS }),
].map((name) => `--${name}`);

/** The parsed arguments for one invocation. */
export interface GithubMergeArgs {
  /**
   * The `owner/name` slug. The report's label, the repository `--admin` addresses, and — since the merge
   * hold — the key deciding WHICH standing hold, if any, governs this invocation.
   */
  readonly repo: string;
  readonly cwd: string | undefined;
  readonly base: string;
  readonly head: string;
  /** The pull request's body text, or `-` to read it from stdin — resolved by the shell, not here. */
  readonly descriptionSource: string;
  readonly deletionThreshold: number;
  readonly acknowledge: readonly string[];
  readonly acknowledgeAll: boolean;
  readonly reason: string | undefined;
  readonly home: string | undefined;
  /**
   * Whether this invocation MERGES, using the repository administrator's branch-protection bypass, once its
   * own report comes back clean. Absent, the verb is exactly the report it has always been.
   */
  readonly admin: boolean;
  /**
   * Whether an `--admin` run stops before its first write: every check the merge makes, in the same order and
   * through the same functions, then `would merge`. Only meaningful with `--admin` — the report alone writes
   * nothing already — so it is refused without it.
   */
  readonly dryRun: boolean;
  /**
   * The pull request this invocation is for. Required by `--admin`, which merges it; optional on the
   * report-only path, where it is how the report identifies itself against a standing merge hold.
   */
  readonly number: number | undefined;
  /** The Git remote `--admin` fetches the base branch from before remeasuring freshness. */
  readonly remote: string;
}

/** One declared string flag, or `undefined`. */
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

/** A required string flag: present, non-blank, or an error naming it. */
function requireString({
  values,
  name,
  errors,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
  errors: string[];
}): string | undefined {
  const value = stringFlag({ name, values });
  if (value === undefined || value.trim().length === 0) {
    errors.push(`--${name} is required`);
    return undefined;
  }
  return value;
}

/** `--acknowledge` as a comma-separated list, matching `blockedBy:`'s list spelling elsewhere in this repo. */
function acknowledgeListFrom({ values }: { values: Readonly<Record<string, string | boolean>> }): readonly string[] {
  const raw = stringFlag({ name: "acknowledge", values });
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** `--deletion-threshold`, a non-negative whole number, defaulting when absent. */
function deletionThresholdFrom({
  values,
  errors,
}: {
  values: Readonly<Record<string, string | boolean>>;
  errors: string[];
}): number {
  const raw = stringFlag({ name: "deletion-threshold", values });
  if (raw === undefined) {
    return DEFAULT_DELETION_THRESHOLD;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    errors.push(`--deletion-threshold must be a non-negative whole number; "${raw}" is not`);
    return DEFAULT_DELETION_THRESHOLD;
  }
  return parsed;
}

/** `--remote`, as given — an empty value included — or {@link DEFAULT_MERGE_REMOTE} when the flag is absent. */
function remoteFrom({ values }: { values: Readonly<Record<string, string | boolean>> }): string {
  const raw = stringFlag({ name: "remote", values });
  if (raw === undefined) {
    return DEFAULT_MERGE_REMOTE;
  }
  return raw;
}

/**
 * `--number`, required by `--admin` and meaningful — since the merge hold — without it too.
 *
 * It used to be REFUSED on the report-only path, on the reasoning that a `--number` which did nothing reads,
 * to the next person, as a merge that was requested and quietly did not happen. That reasoning is exactly
 * right and it stopped applying: a standing merge hold names ONE pull request, so a report that does not say
 * which pull request it is for cannot be told apart from the held one and is refused (see
 * `../../../outbound/github/mergeHold.js`). `--number` is now how a report identifies itself, so it does
 * something on both paths.
 */
function pullRequestNumberFrom({
  values,
  admin,
  errors,
}: {
  values: Readonly<Record<string, string | boolean>>;
  admin: boolean;
  errors: string[];
}): number | undefined {
  const raw = stringFlag({ name: "number", values });
  if (raw === undefined) {
    if (admin) {
      errors.push("--admin must name the pull request to merge with --number <n>");
    }
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    errors.push(`--number must be a positive whole number; "${raw}" is not`);
    return undefined;
  }
  return parsed;
}

/**
 * Parse this verb's arguments.
 *
 * @param argv the verb's own argument tail (after `github merge`)
 * @returns the parsed arguments, or every usage error at once
 */
export function parseGithubMergeArgs({ argv }: { argv: readonly string[] }): Result<GithubMergeArgs> {
  const parsed = parseFlags({ args: argv, spec: GITHUB_MERGE_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const errors: string[] = [];
  const repo = requireString({ errors, name: "repo", values });
  const base = requireString({ errors, name: "base", values });
  const head = requireString({ errors, name: "head", values });
  const descriptionSource = requireString({ errors, name: "description", values });
  const deletionThreshold = deletionThresholdFrom({ errors, values });
  const acknowledgeAll = values["acknowledge-all"] === true;
  const reason = stringFlag({ name: "reason", values });
  if (acknowledgeAll && (reason === undefined || reason.trim().length === 0)) {
    errors.push('--acknowledge-all must be paired with --reason "…" explaining why every finding is accepted');
  }
  const admin = values["admin"] === true;
  const dryRun = values["dry-run"] === true;
  if (dryRun && !admin) {
    errors.push("--dry-run describes the --admin landing without writing, so it requires --admin");
  }
  const number = pullRequestNumberFrom({ admin, errors, values });
  if (errors.length > 0) {
    return err(errors);
  }
  return ok({
    acknowledge: acknowledgeListFrom({ values }),
    acknowledgeAll,
    admin,
    base: base!,
    cwd: stringFlag({ name: "cwd", values }),
    deletionThreshold,
    descriptionSource: descriptionSource!,
    dryRun,
    head: head!,
    home: stringFlag({ name: "home", values }),
    number,
    reason,
    remote: remoteFrom({ values }),
    repo: repo!,
  });
}
