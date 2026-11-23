/**
 * The effectful edge behind {@link ./mentionResolver}: read member bronze and settle the org's own email
 * domains, once per home per process.
 *
 * Both reads are cheap and neither can refuse the way `derive` does — the member files are a few MiB of
 * JSONL, not the whole corpus — which is the entire point of resolving a mention here instead of there.
 * The memo is for a single turn addressing several people, not for durability: a process that outlives a
 * `refresh` is a CLI verb that has already answered.
 */
import { readFileSync } from "node:fs";
import { readAllMembers } from "../corpus/members/store.js";
import type { MemberBronzeRow } from "../corpus/members/types.js";
import { safeFs } from "../lib/safeBoundary.js";
import { stateHomePaths } from "../stateHome.js";
import { parseOrgDomainsFile, resolveOrgDomains } from "./orgDomains.js";

/** Member bronze plus the org domains it was classified against, and anything that went wrong reading it. */
export interface MemberDirectory {
  readonly rows: readonly MemberBronzeRow[];
  readonly orgDomains: readonly string[];
  /** How the domains were established — or, when they could not be, why not. */
  readonly basis: string;
  /** Parse warnings from member bronze, plus the org-domain refusal when there was one. */
  readonly warnings: readonly string[];
}

const cache = new Map<string, MemberDirectory>();

/**
 * Read the operator's declared org domains from `$SLOPWEAVER_HOME/org-domains.txt` (absent ⇒ none).
 *
 * @internal
 * @param home the Slopweaver home
 * @returns the declared domains, or empty when the file is absent or carries nothing usable
 */
export function loadConfiguredOrgDomains({ home }: { home: string }): readonly string[] {
  const path = stateHomePaths({ home }).orgDomains;
  const read = safeFs({ execute: () => readFileSync(path, "utf8"), operation: "readOrgDomains", path });
  return read.isOk() ? parseOrgDomainsFile({ content: read.value }) : [];
}

/**
 * The org domains for a home and how they were settled — or, when the corpus refused to settle them, no domain,
 * an `unsettled` basis, and the refusal line explaining why. {@link memberDirectory} says why an empty set is
 * the safe answer to a refusal.
 */
function orgDomainsFor({ home, rows }: { home: string; rows: readonly MemberBronzeRow[] }): {
  basis: string;
  orgDomains: readonly string[];
  warnings: readonly string[];
} {
  const settled = resolveOrgDomains({ configured: loadConfiguredOrgDomains({ home }), rows });
  return settled.isOk()
    ? { basis: settled.value.basis, orgDomains: settled.value.domains, warnings: [] }
    : { basis: "unsettled", orgDomains: [], warnings: settled.error };
}

/**
 * The member directory for a home — read once per process.
 *
 * An org-domain refusal yields an EMPTY domain set rather than a throw, and that is the safe direction: with
 * no domains, every member classifies as `external` or `unverified`, so every name-based mention refuses and
 * names the reason. A resolution that cannot tell a colleague from a stranger must decline to tell them
 * apart, not guess.
 *
 * @param home the Slopweaver home
 * @returns the member rows, the org domains, how they were settled, and every warning raised getting there
 */
export function memberDirectory({ home }: { home: string }): MemberDirectory {
  const cached = cache.get(home);
  if (cached !== undefined) {
    return cached;
  }
  const members = readAllMembers({ home });
  const domains = orgDomainsFor({ home, rows: members.rows });
  const directory: MemberDirectory = {
    basis: domains.basis,
    orgDomains: domains.orgDomains,
    rows: members.rows,
    warnings: [...members.warnings, ...domains.warnings],
  };
  cache.set(home, directory);
  return directory;
}

/**
 * Forget every memoised directory — for a test that writes a home and reads it back.
 *
 * @internal
 */
export function resetMemberDirectoryCache(): void {
  cache.clear();
}
