/**
 * Which provider account each registered Codex store draws on — the one join `codex reset --at-limit`
 * (`./resetFleet.ts`) and the pass reservation (`./passReservation.ts`) both stand on. Pure.
 *
 * ## The join
 *
 * Every store is identified by its own directory, by the provider's `accountId` when the live read carried one,
 * and by the signed-in address, lower-cased. Two stores sharing ANY of those, directly or through a third, are one
 * account: the provider may omit its id on one store and give it on another, so either one shared pairs two stores.
 *
 * ## What is PROVEN, and what a reservation may key on
 *
 * The store directory always participates in the join, but it says nothing about the account behind it — a store
 * re-signed into another account keeps its directory. So a group is PROVEN only when at least one member carried a
 * provider identity (an id or an address), and only those provider identities are kept, each as a sha256 digest so
 * the owner-only reservation document never holds an address or an account id in clear. A group with none has
 * `accountKey` undefined, and a usage-limited one is refused a pass rather than reserved against a guess.
 *
 * A reservation COUNTS on more than it proves: its row also carries each member store's digest
 * (`storeIdentities`), so a store that names its account differently on the next read still counts its own row.
 */
import { createHash } from "node:crypto";
import { normalize, sep } from "node:path";

import type { CodexAccountLive } from "./accountLiveParse.js";
import type { CodexDestination } from "./destinations.js";

/** One registered store, paired with what the live read found in it. */
export interface CodexAccountCandidate {
  readonly destination: CodexDestination;
  readonly live: CodexAccountLive;
}

/** The stores one provider account draws on, and what proves it. */
export interface CodexAccountGroup {
  /** A digest of every provider identity the group carries, or undefined when nothing beyond a store proves it. */
  readonly accountKey: string | undefined;
  /** The candidates' own indexes into the list grouped, in register order. */
  readonly members: readonly number[];
  /** One sha256 digest per provider identity (`account:` id, `email:` address), sorted; empty when unproven. */
  readonly provenIdentities: readonly string[];
  /**
   * One sha256 digest per member's store directory, sorted. Never proof of an account, but a reservation keys on it
   * too: one store may give its id on one read and only its address on the next, and a row keyed on provider
   * identities alone would then stop counting against its own account (Codex review). Over-counting a store
   * re-signed into another account only holds it out until the row expires — the safe side.
   */
  readonly storeIdentities: readonly string[];
}

/**
 * A store's own identity, its directory normalised lexically first — dot segments, a trailing slash, and Unicode to
 * NFC, the form the register's own duplicate check compares: the register accepts `/a/.codex` and `/a/.codex/` (or a
 * composed and a decomposed accent) as two rows, and split into two groups they would let an unlimited alias of a
 * limited store skip its reservations (both found by a Codex review). Purely lexical, never against the working
 * directory: two passes started from different directories must give one relative store one identity (also Codex).
 * A symlinked or differently cased spelling is not joined — that would read the filesystem.
 */
function storeIdentityOf({ codexHome }: { codexHome: string }): string {
  const lexical = normalize(codexHome.normalize("NFC"));
  const trimmed = lexical.length > 1 && lexical.endsWith(sep) ? lexical.slice(0, -1) : lexical;
  return `store:${trimmed}`;
}

/** Every identity naming the account a candidate draws on, the store itself always first. */
function identitiesOf({ candidate }: { candidate: CodexAccountCandidate }): readonly string[] {
  const { live } = candidate;
  const identities = [storeIdentityOf({ codexHome: candidate.destination.codexHome })];
  if (live.kind === "signed-in" && live.accountId !== undefined) {
    identities.push(`account:${live.accountId}`);
  }
  if (live.kind === "signed-in" && live.email !== undefined) {
    identities.push(`email:${live.email.toLowerCase()}`);
  }
  return identities;
}

/** The index a candidate's account group is keyed by — the earliest-registered member it is joined to. */
function rootOf({ index, parent }: { index: number; parent: readonly number[] }): number {
  let root = index;
  while (parent[root] !== root) {
    root = parent[root]!;
  }
  return root;
}

/**
 * The account each candidate draws on, as the index of the earliest-registered candidate it is joined to.
 *
 * @param candidates the stores in register order
 * @returns one root index per candidate, in the same order — two candidates with one root are one account
 */
export function codexAccountRoots({ candidates }: { candidates: readonly CodexAccountCandidate[] }): readonly number[] {
  const parent = candidates.map((_, index) => index);
  const firstWith = new Map<string, number>();
  candidates.forEach((candidate, index) => {
    for (const identity of identitiesOf({ candidate })) {
      const seen = firstWith.get(identity);
      if (seen === undefined) {
        firstWith.set(identity, index);
        continue;
      }
      const [low, high] = [rootOf({ index: seen, parent }), rootOf({ index, parent })].toSorted((a, b) => a - b);
      parent[high!] = low!;
    }
  });
  return candidates.map((_, index) => rootOf({ index, parent }));
}

/** The hex sha256 of one string — the form a provider identity takes once it leaves this module. */
function digestOf({ text }: { text: string }): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Group the candidates by the account they draw on, earliest-registered group first.
 *
 * @param candidates the stores in register order
 * @returns one group per account, each naming its members and the provider identities that prove it
 */
export function groupCodexAccounts({
  candidates,
}: {
  candidates: readonly CodexAccountCandidate[];
}): readonly CodexAccountGroup[] {
  const roots = codexAccountRoots({ candidates });
  const byRoot = new Map<number, number[]>();
  roots.forEach((root, index) => {
    const members = byRoot.get(root);
    if (members === undefined) {
      byRoot.set(root, [index]);
    } else {
      members.push(index);
    }
  });
  return [...byRoot.values()].map((members): CodexAccountGroup => {
    const provider = new Set(
      members.flatMap((index) =>
        identitiesOf({ candidate: candidates[index]! }).filter((identity) => !identity.startsWith("store:")),
      ),
    );
    const provenIdentities = [...provider].map((identity) => digestOf({ text: identity })).toSorted();
    const accountKey = provenIdentities.length === 0 ? undefined : digestOf({ text: provenIdentities.join("\n") });
    const storeIdentities = members
      .map((index) => digestOf({ text: storeIdentityOf({ codexHome: candidates[index]!.destination.codexHome }) }))
      .toSorted();
    return { accountKey, members, provenIdentities, storeIdentities };
  });
}
