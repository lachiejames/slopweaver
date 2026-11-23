/**
 * `slopweaver github enqueue`'s argv contract — the flags, the usage text, the parsed shape and the one
 * function that turns one into the other. Pure.
 *
 * Its own module because the verb's argv is a surface three other files read without caring how the write is
 * judged: the help-truth ratchet takes {@link GITHUB_ENQUEUE_FLAG_NAMES}, the press builds an argv from the
 * same flags (`./landingPress.ts`), and the shell in `./enqueueRun.ts` parses before it reads anything. The
 * DECISIONS the verb makes over what it read stay in `./enqueueCore.ts`.
 */
import { statesAReason } from "../../../codex/statesAReason.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { parseFlags } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";
import { REASON_REQUIRED_SUBJECTS } from "./enqueueAcknowledgements.js";

// The run modules read their usage line through this module, which they import anyway; the manifest reads the
// leaf itself, so the command module never sits on the barrel's load path.
export { GITHUB_ENQUEUE_USAGE } from "./prUsage.js";

/** The flags this verb accepts. */
export const GITHUB_ENQUEUE_FLAGS: FlagSpec = {
  boolean: ["dequeue", "dry-run", "json", "acknowledge-all"],
  string: ["repo", "pr", "acknowledge", "reason", "home"],
};

/**
 * Every accepted flag, WITH the `--`, for the help-truth ratchet.
 *
 * Both halves of {@link FlagSpec} are optional and this verb declares both, so the empty defaults are stated
 * where a reader sees them rather than substituted by an operator mid-expression.
 */
const { boolean: BOOLEAN_FLAGS = [], string: STRING_FLAGS = [] } = GITHUB_ENQUEUE_FLAGS;
export const GITHUB_ENQUEUE_FLAG_NAMES: readonly string[] = [...STRING_FLAGS, ...BOOLEAN_FLAGS].map(
  (name) => `--${name}`,
);

/** The parsed arguments for one invocation. */
export interface GithubEnqueueArgs {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  /** Run the verb backwards: take the pull request OUT of the queue. */
  readonly dequeue: boolean;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly acknowledge: readonly string[];
  readonly acknowledgeAll: boolean;
  readonly reason: string | undefined;
  readonly home: string | undefined;
}

/** `--acknowledge` as a comma-separated list, matching `github merge`'s own spelling. */
function acknowledgeListFrom({ values }: { values: Readonly<Record<string, string | boolean>> }): readonly string[] {
  const raw = values["acknowledge"];
  if (typeof raw !== "string") {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * The usage errors for subjects whose acknowledgement is RECORDED rather than merely accepted.
 *
 * Those are the ones that cannot be waived silently: the reason is what the ledger row carries, so a waiver
 * with none is a row nobody can audit. Every other subject keeps the behaviour it has always had.
 *
 * @param named the subjects this invocation's `--acknowledge` listed
 * @param reason the `--reason` text, when one was given
 * @returns one error per reason-requiring subject named without one, in registry order
 */
function reasonPairingErrors({
  named,
  reason,
}: {
  named: readonly string[];
  reason: string | undefined;
}): readonly string[] {
  if (statesAReason({ reason })) {
    return [];
  }
  return REASON_REQUIRED_SUBJECTS.filter((subject) => named.includes(subject)).map(
    (subject) =>
      `--acknowledge ${subject} must be paired with --reason "…" — the reason is written to the door ` +
      "ledger, so a waived finding stays findable afterwards",
  );
}

/**
 * Parse this verb's arguments.
 *
 * @param rest argv after `github enqueue`
 * @returns the parsed arguments, or every usage error at once
 */
export function parseGithubEnqueueArgs({ rest }: { rest: readonly string[] }): Result<GithubEnqueueArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_ENQUEUE_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const errors: string[] = [];
  const repoValue = values["repo"];
  const slug = typeof repoValue === "string" ? parseRepoSlug({ slug: repoValue }) : undefined;
  if (slug === undefined) {
    errors.push("--repo owner/name is required");
  }
  const prValue = values["pr"];
  const number = typeof prValue === "string" ? Number(prValue) : Number.NaN;
  if (!Number.isInteger(number) || number <= 0) {
    errors.push("--pr must be a positive whole number");
  }
  const acknowledgeAll = values["acknowledge-all"] === true;
  const reason = typeof values["reason"] === "string" ? values["reason"] : undefined;
  if (acknowledgeAll && (reason === undefined || reason.trim().length === 0)) {
    errors.push('--acknowledge-all must be paired with --reason "…" explaining why every finding is accepted');
  }
  errors.push(...reasonPairingErrors({ named: acknowledgeListFrom({ values }), reason }));
  if (errors.length > 0 || slug === undefined) {
    return err(errors);
  }
  const home = values["home"];
  return ok({
    acknowledge: acknowledgeListFrom({ values }),
    acknowledgeAll,
    dequeue: values["dequeue"] === true,
    dryRun: values["dry-run"] === true,
    home: typeof home === "string" ? home : undefined,
    json: values["json"] === true,
    number,
    owner: slug.owner,
    reason,
    repo: slug.repo,
  });
}
