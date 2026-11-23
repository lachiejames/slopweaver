/**
 * `slopweaver github stack` — the thin, pure dispatch between stack sub-verbs.
 *
 * Each sub-verb (`push`, `sync`, `adopt`) keeps its OWN flag spec and parser in its own `stack<Verb>Core.ts`,
 * because their flags genuinely differ — this file only decides which one an invocation names, the same way
 * `pr`'s `create`/`update` split works, one level up.
 */
import { err, ok } from "../../../lib/result.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";
import { GITHUB_STACK_RESTACK_FLAG_NAMES } from "./restackForestRun.js";
import { GITHUB_STACK_ADOPT_FLAG_NAMES } from "./stackAdoptCore.js";
import { GITHUB_STACK_AUDIT_FLAG_NAMES } from "./stackAuditCore.js";
import { GITHUB_STACK_DISSOLVE_FLAG_NAMES } from "./stackDissolveCore.js";
import { GITHUB_STACK_PUSH_FLAG_NAMES } from "./stackPushCore.js";
import { GITHUB_STACK_REMOVE_FLAG_NAMES } from "./stackRemoveCore.js";
import { GITHUB_STACK_SUBMIT_FLAG_NAMES } from "./stackSubmitRun.js";
import { GITHUB_STACK_SYNC_FLAG_NAMES } from "./stackSyncCore.js";

/** Every flag ANY stack sub-verb accepts, for the repo-wide help-truth ratchet. Grows additively per phase. */
export const GITHUB_STACK_FLAG_NAMES: readonly string[] = [
  ...new Set([
    ...GITHUB_STACK_PUSH_FLAG_NAMES,
    ...GITHUB_STACK_SYNC_FLAG_NAMES,
    ...GITHUB_STACK_ADOPT_FLAG_NAMES,
    ...GITHUB_STACK_AUDIT_FLAG_NAMES,
    ...GITHUB_STACK_REMOVE_FLAG_NAMES,
    ...GITHUB_STACK_DISSOLVE_FLAG_NAMES,
    ...GITHUB_STACK_RESTACK_FLAG_NAMES,
    ...GITHUB_STACK_SUBMIT_FLAG_NAMES,
  ]),
];

const SUB_VERBS = ["push", "sync", "restack", "submit", "adopt", "audit", "remove", "dissolve"] as const;

/** Which stack sub-verb an invocation named, and its own remaining argument tail. */
export interface GithubStackDispatch {
  readonly subVerb: (typeof SUB_VERBS)[number];
  readonly rest: readonly string[];
}

/** A narrowing guard for the fixed set of recognised sub-verbs. */
function isSubVerb(value: string | undefined): value is (typeof SUB_VERBS)[number] {
  return value !== undefined && (SUB_VERBS as readonly string[]).includes(value);
}

/**
 * Decide which stack sub-verb an invocation names.
 *
 * @param argv the verb's own argument tail, after `github stack`
 * @returns the named sub-verb and its own remaining tail, or a usage error
 */
export function parseGithubStackDispatch({ argv }: { argv: readonly string[] }): GithubVerbResult<GithubStackDispatch> {
  const subVerb = argv[0];
  if (!isSubVerb(subVerb)) {
    return err(GithubVerbErrors.usage({ command: "stack", shape: `<${SUB_VERBS.join("|")}>` }));
  }
  return ok({ rest: argv.slice(1), subVerb });
}
