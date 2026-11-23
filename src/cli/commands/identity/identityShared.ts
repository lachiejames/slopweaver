/**
 * The argv and store plumbing all four `slopweaver identity` verbs share, and nothing else.
 *
 * This module is DELIBERATELY empty of output vocabulary: it declares the injected seam and three argv
 * helpers, and it names no person, no group and no roster. That is what lets {@link ./identityOrgDomains}
 * — which prints the domain list the resolution checks against — sit at the same depth as {@link
 * ./identityShow} with no import edge to any code that can emit a person.
 */

import type { MemberBronzeRow } from "../../../corpus/members/types.js";
import type { Logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { MentionGroup } from "../../../silver/groupMention.js";
import type { IdentityRecord, PersonIdentity } from "../../../silver/identity.js";
import type { IdentityRosterError } from "../../../silver/identityRosterErrors.js";
import type { MemberDirectory } from "../../../silver/memberDirectory.js";

/** The injectable effectful seams the `identity` shells compose (fakes in tests). */
export interface IdentityDeps {
  readonly home: () => string;
  /** The human roster the store holds — the confirmations every resolution layers over what it discovers. */
  readonly loadRoster: (args: { home: string }) => Promise<Result<readonly IdentityRecord[], IdentityRosterError>>;
  /**
   * The per-source identities the CORPUS contributes — the discovery leg, for a person who appears as a
   * record author and is in no members index. Candidates rather than records on purpose: see
   * {@link ../../../silver/identityCandidateStream} for the measurement that made this a stream. `refused` is
   * the owner's protect list refusing the corpus, which fails the verb rather than resolving without it.
   */
  readonly loadCandidates: (args: { home: string; corpus?: string }) => {
    candidates: readonly PersonIdentity[];
    refused?: string;
    warnings: readonly string[];
  };
  /** Hydrated member rows (PR4.1) — fed to the resolver's email tier so `show` unifies without a prior derive. */
  readonly loadMembers: (args: { home: string }) => { rows: readonly MemberBronzeRow[]; warnings: readonly string[] };
  /**
   * Member bronze plus the org's own email domains — the leg `resolve` answers from FIRST, and the only one
   * that has no `derive` behind it at all.
   */
  readonly loadDirectory: (args: { home: string }) => MemberDirectory;
  /**
   * The Slack usergroups the CORPUS holds — the leg that answers a GROUP token, which the member index
   * cannot. A store holding none answers none, and `resolve` then refuses exactly as it did before.
   */
  readonly loadGroups: (args: { home: string }) => readonly MentionGroup[];
  readonly logger: Pick<Logger, "error" | "out" | "warn">;
}

/**
 * Read a string flag out of a parsed argv.
 *
 * @returns the flag's value, or `undefined` — parseArgs hands back a boolean for a value-less flag, and a
 * boolean is never an answer to "which directory", so it is reported as absent rather than coerced.
 */
export function strFlag({
  values,
  key,
}: {
  values: Readonly<Record<string, string | boolean>>;
  key: string;
}): string | undefined {
  const value = values[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * The store this invocation reads: the `--home` the caller named, or — said out loud rather than folded into
 * an operator — the process default. `no-silent-fallback` is why this is a function: four `?? deps.home()`
 * sites stood in this file, none of them naming the absent case.
 *
 * @returns the store directory to read
 */
export function homeFor({
  values,
  deps,
}: {
  values: Readonly<Record<string, string | boolean>>;
  deps: IdentityDeps;
}): string {
  const named = strFlag({ key: "home", values });
  if (named === undefined) {
    return deps.home();
  }
  return named;
}

/**
 * Drop a leading verb word (`show`/`resolve`) so bare `identity` and explicit `identity show` both parse.
 *
 * @returns the argv tail the verb's own flag parser sees
 */
export function verbTail({ argv, verb }: { argv: readonly string[]; verb: string }): readonly string[] {
  const rest = argv.slice(3);
  return rest[0] === verb ? rest.slice(1) : rest;
}
