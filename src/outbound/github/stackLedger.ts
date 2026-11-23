/**
 * The local record of which pull requests are part of THIS operator's stack state — the "local-state
 * registration scope" the `github-stack-verbs` doc names: `github stack sync` must only ever act on a PR
 * that was registered here by `stack push` or `stack adopt`, never on every native-stack PR the operator
 * happens to have authored. Reading a native GitHub stack that contains a PR nobody registered here must
 * never silently pull it into local state — that is exactly the drift this ledger exists to prevent.
 *
 * Same shape and same reasoning as `./prLedger.ts`, deliberately: this is NOT new infrastructure, it is the
 * identical one-JSON-file-per-locus pattern reused for a different membership question. `prLedger.ts`'s own
 * header explains why it stopped being an ownership authority; this file was never one to begin with — it
 * only ever answers "did *I* register this PR," which needs no live read to check.
 */
import { mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "#lib/writeAtomic.js";

import { isRecord } from "../../lib/parsers.js";
import { stateHomePaths } from "../../stateHome.js";
import { locusFilename } from "./prLedger.js";

/** How a stack member was registered — never inferred, always the verb that actually did it. */
export type StackMemberVia = "push" | "adopt";

/** One PR registered into local stack state. */
interface StackMemberRecord {
  /** `owner/repo#number`, lower-cased on `owner/repo` only — the record's locus and filename source. */
  readonly locus: string;
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly via: StackMemberVia;
  readonly registeredAtIso: string;
}

/**
 * The locus for one stack member — owner/repo lower-cased (repository names are case-insensitive), the PR
 * number is not (it needs no casing at all).
 *
 * @param owner the repository owner
 * @param repo the repository name
 * @param number the pull-request number
 * @returns a stable key
 */
export function stackMemberLocusOf({ owner, repo, number }: { owner: string; repo: string; number: number }): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}#${String(number)}`;
}

/** The directory holding one record per registered stack member. */
function ledgerDir({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).ledgers, "github-stack-members");
}

function recordPath({ home, locus }: { home: string; locus: string }): string {
  return join(ledgerDir({ home }), `${locusFilename({ locus })}.json`);
}

/** Parse a record, returning undefined when it is absent or unreadable — an unreadable record is simply
 * not a registration, never a reason to fail the caller. */
function parseStackMemberRecord({ raw }: { raw: string }): StackMemberRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      typeof parsed["locus"] !== "string" ||
      typeof parsed["owner"] !== "string" ||
      typeof parsed["repo"] !== "string" ||
      typeof parsed["number"] !== "number" ||
      typeof parsed["registeredAtIso"] !== "string" ||
      (parsed["via"] !== "push" && parsed["via"] !== "adopt")
    ) {
      return undefined;
    }
    return {
      locus: parsed["locus"],
      number: parsed["number"],
      owner: parsed["owner"],
      registeredAtIso: parsed["registeredAtIso"],
      repo: parsed["repo"],
      via: parsed["via"],
    };
  } catch {
    return undefined;
  }
}

/**
 * Register one PR into local stack state. Idempotent by design — re-registering the same PR (e.g. running
 * `stack push` again, or `sync` re-registering nothing) just overwrites the record; there is no at-most-once
 * guard here, unlike `prLedger.ts`'s create reservation, because registration is a fact about local intent,
 * not a remote side effect that can only safely happen once.
 *
 * @param home the state home the ledger lives under
 * @param owner the repository owner
 * @param repo the repository name
 * @param number the pull-request number
 * @param via which verb registered it
 * @param nowIso when the registration happened
 */
export function registerStackMember({
  home,
  owner,
  repo,
  number,
  via,
  nowIso,
}: {
  home: string;
  owner: string;
  repo: string;
  number: number;
  via: StackMemberVia;
  nowIso: string;
}): void {
  mkdirSync(ledgerDir({ home }), { recursive: true });
  const locus = stackMemberLocusOf({ number, owner, repo });
  const record: StackMemberRecord = { locus, number, owner, registeredAtIso: nowIso, repo, via };
  writeFileAtomic({ contents: JSON.stringify(record), path: recordPath({ home, locus }) });
}

/**
 * Unregister one PR from local stack state — `stack remove` and `stack dissolve`'s counterpart to
 * {@link registerStackMember}. Idempotent: a locus with no record is simply left absent rather than treated
 * as a failure, matching `registerStackMember`'s own "registration is a fact about local intent" reasoning.
 *
 * @param home the state home the ledger lives under
 * @param owner the repository owner
 * @param repo the repository name
 * @param number the pull-request number
 */
export function unregisterStackMember({
  home,
  owner,
  repo,
  number,
}: {
  home: string;
  owner: string;
  repo: string;
  number: number;
}): void {
  const locus = stackMemberLocusOf({ number, owner, repo });
  try {
    unlinkSync(recordPath({ home, locus }));
  } catch {
    // Already absent — nothing to unregister.
  }
}

/**
 * Whether one PR is registered in local stack state.
 *
 * @param home the state home the ledger lives under
 * @param owner the repository owner
 * @param repo the repository name
 * @param number the pull-request number
 * @returns true when a record exists for this exact locus
 */
export function isRegisteredStackMember({
  home,
  owner,
  repo,
  number,
}: {
  home: string;
  owner: string;
  repo: string;
  number: number;
}): boolean {
  const locus = stackMemberLocusOf({ number, owner, repo });
  try {
    return parseStackMemberRecord({ raw: readFileSync(recordPath({ home, locus }), "utf8") }) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Every PR number registered in local stack state for one repository.
 *
 * Records are named by a digest, so every file in the ledger directory is read and filtered by repository —
 * there is no cheaper index, and the ledger is expected to stay small (one file per stacked PR a single
 * operator has ever pushed or adopted). An unreadable record is skipped rather than reported, matching
 * `prLedger.ts#listPrLoci`'s own reasoning: a corrupt file names no PR, and nothing downstream may act on
 * one anyway.
 *
 * @param home the state home the ledger lives under
 * @param owner the repository owner
 * @param repo the repository name
 * @returns every registered PR number for this repository, sorted
 */
export function listRegisteredStackMembers({
  home,
  owner,
  repo,
}: {
  home: string;
  owner: string;
  repo: string;
}): readonly number[] {
  const wantedOwner = owner.toLowerCase();
  const wantedRepo = repo.toLowerCase();
  try {
    return readdirSync(ledgerDir({ home }))
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        try {
          return parseStackMemberRecord({ raw: readFileSync(join(ledgerDir({ home }), name), "utf8") });
        } catch {
          return undefined;
        }
      })
      .filter((record): record is StackMemberRecord => record !== undefined)
      .filter((record) => record.owner.toLowerCase() === wantedOwner && record.repo.toLowerCase() === wantedRepo)
      .map((record) => record.number)
      .toSorted((a, b) => a - b);
  } catch {
    return [];
  }
}
