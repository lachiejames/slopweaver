/**
 * WHICH pull request a proof record is about — so a finding that counts pull requests never counts one twice, and
 * never counts two the records cannot tell apart.
 *
 * `./collectPrProof.ts` reads each record's grade; this file groups records into pull requests. GitHub's own
 * identity wins: a base retarget re-keys a record's branch locus while the pull request stays one, so
 * the node id and the repository plus number are its keys, and a record carrying both ties the two together. A group whose identities do not establish how many pull requests it is counts none.
 *
 * Pure: records in, groups out.
 */
import { field, type Sighting } from "./substrate.js";

/** What one record says of its pull request: a below-gold grade, the grade's own words, or a stranded reservation. */
export interface PrReading {
  readonly grade?: Sighting;
  readonly gradeSaid?: string;
  readonly stranded?: Sighting;
}

/** One in-window record of a pull request: every key naming it, its label, what it says, and its instant. */
export interface PrEntry {
  readonly keys: readonly string[];
  readonly label: string;
  readonly read: PrReading;
  readonly stampMs: number;
}

/**
 * A locus with its repository case-folded. GitHub repository names are case-insensitive, as `prLedger.ts` folds them
 *, so `Owner/Repo#…` and `owner/repo#…` are one pull request. Branch names after the `#` are
 * case-sensitive in git, so they keep theirs.
 */
function caseFoldedRepository({ locus }: { locus: string }): string {
  const hash = locus.indexOf("#");
  if (hash < 0) {
    return locus;
  }
  return `${locus.slice(0, hash).toLowerCase()}${locus.slice(hash)}`;
}

/**
 * Which pull request a record is about, as every key that names it; an unconfirmed reservation has no GitHub
 * identity and is its locus, else its file.
 *
 * @param name the record's file name, the key of last resort
 * @returns every key, and whether any of them is GitHub's own identity
 */
export function prIdentity({ record, name }: { record: Readonly<Record<string, unknown>>; name: string }): {
  readonly github: boolean;
  readonly keys: readonly string[];
} {
  const keys: string[] = [];
  const nodeId = field({ key: "nodeId", record });
  if (nodeId.length > 0) {
    keys.push(`node:${nodeId}`);
  }
  const locus = caseFoldedRepository({ locus: field({ key: "locus", record }) });
  const number = record["number"];
  // Only a number GitHub could have issued names a pull request: a positive integer.
  if (typeof number === "number" && Number.isInteger(number) && number > 0 && locus.includes("#")) {
    keys.push(`number:${locus.slice(0, locus.indexOf("#"))}#${String(number)}`);
  }
  const github = keys.length > 0;
  // The locus is a key too: a record naming its pull request by node id alone and another by number
  // alone share nothing else, so their shared branch is what groups them — and the group then has to prove it is
  // one pull request ({@link latestReading}). A record carrying BOTH is fully identified and never joins by branch
  // Two pull requests on one reused branch, each fully named, stay two rather than one ambiguous group.
  const fullyIdentified = keys.length === 2;
  if (locus.length > 0 && !fullyIdentified) {
    keys.push(`locus:${locus}`);
  }
  if (keys.length === 0) {
    keys.push(`file:${name}`);
  }
  return { github, keys };
}

/**
 * Group records that share any key, transitively, so each group is ONE pull request however its records name it.
 *
 * @returns the groups, each a non-empty list of entries
 */
export function groupByIdentity({ entries }: { entries: readonly PrEntry[] }): readonly (readonly PrEntry[])[] {
  const groups: PrEntry[][] = [];
  for (const entry of entries) {
    const touching = groups.filter((group) => group.some((held) => held.keys.some((key) => entry.keys.includes(key))));
    const merged = [...touching.flat(), entry];
    const rest = groups.filter((group) => !touching.includes(group));
    groups.length = 0;
    groups.push(...rest, merged);
  }
  return groups;
}

/** Which GitHub identity kinds a group names, and the repositories its keys place it in. */
function identityShape({ group }: { group: readonly PrEntry[] }): {
  readonly nodes: boolean;
  readonly numbers: boolean;
  readonly repos: ReadonlySet<string>;
} {
  const keys = group.flatMap((entry) => entry.keys);
  const placed = keys.filter((key) => (key.startsWith("locus:") || key.startsWith("number:")) && key.includes("#"));
  return {
    nodes: keys.some((key) => key.startsWith("node:")),
    numbers: keys.some((key) => key.startsWith("number:")),
    repos: new Set(placed.map((key) => key.slice(key.indexOf(":") + 1, key.indexOf("#")))),
  };
}

/**
 * The positions of groups the records never prove distinct from another group. Two groups that share
 * no key are two pull requests only when they differ on one identity KIND — two node ids, or two numbers. One group
 * named only by node id and another only by number, in the same repository or an unknown one, may be one retargeted
 * pull request, so neither is counted.
 *
 * @returns the indices into `groups` whose count the records do not establish
 */
export function unprovenDistinct({ groups }: { groups: readonly (readonly PrEntry[])[] }): ReadonlySet<number> {
  const shapes = groups.map((group) => identityShape({ group }));
  const unproven = new Set<number>();
  for (const [index, shape] of shapes.entries()) {
    for (const [other, against] of shapes.entries()) {
      const nodeOnlyBesideNumberOnly = shape.nodes && !shape.numbers && against.numbers && !against.nodes;
      const sameOrUnknownRepo =
        shape.repos.size === 0 || against.repos.size === 0 || [...shape.repos].some((repo) => against.repos.has(repo));
      if (index !== other && nodeOnlyBesideNumberOnly && sameOrUnknownRepo) {
        unproven.add(index);
        unproven.add(other);
      }
    }
  }
  return unproven;
}

/** What one record says of its pull request — its grade class and its stranded class — so two can be compared. */
function readingKey({ read }: { read: PrReading }): string {
  // The grade's own words, not only its class: two unrecognised grades share one class while the sentence quotes the
  // raw grade, so "bogus-a" beside "bogus-b" equally latest is a conflict, never filename order's pick.
  return JSON.stringify([read.grade?.classKey, read.gradeSaid, read.stranded?.classKey]);
}

/** One pull request's reading, as {@link latestReading} reports it. */
interface PrGroupReading {
  readonly ambiguous: boolean;
  readonly conflicted: boolean;
  readonly label: string;
  readonly labels: readonly string[];
  readonly read: PrReading;
  readonly records: number;
  readonly unconfirmed: readonly Sighting[];
}

/**
 * Whether a group's GitHub identities fail to establish ONE pull request. A group naming two — two node
 * ids, or two numbers — is not one, and how many it is the records cannot say. Nor is a group whose node id and
 * number no single record ties together: a branch can be reused, so a shared locus alone proves nothing.
 */
function identitiesAmbiguous({ group }: { group: readonly PrEntry[] }): boolean {
  const keys = new Set(group.flatMap((entry) => entry.keys));
  const nodes = [...keys].filter((key) => key.startsWith("node:")).length;
  const numbers = [...keys].filter((key) => key.startsWith("number:")).length;
  const tied = group.some(
    (entry) => entry.keys.some((key) => key.startsWith("node:")) && entry.keys.some((key) => key.startsWith("number:")),
  );
  return nodes > 1 || numbers > 1 || (nodes === 1 && numbers === 1 && !tied);
}

/**
 * One pull request's reading: its latest record's, and conflicted when two records equally latest disagree,
 * since filename order never picks one.
 *
 * @param group one pull request's records, never empty
 * @returns the reading, with whether its count or its state is in doubt
 */
export function latestReading({ group }: { group: readonly PrEntry[] }): PrGroupReading {
  const newest = Math.max(...group.map(({ stampMs }) => stampMs));
  const atNewest = group.filter(({ stampMs }) => stampMs === newest);
  const first = atNewest[0]!;
  const conflicted = atNewest.some((entry) => readingKey({ read: entry.read }) !== readingKey({ read: first.read }));
  // A reservation finding counts RESERVATIONS, not pull requests: every reservation record after the
  // group's latest confirmation is one nothing confirmed — and one before it WAS confirmed.
  const confirmations = group.filter(({ read }) => read.stranded === undefined).map(({ stampMs }) => stampMs);
  const lastConfirmed = confirmations.length === 0 ? Number.NEGATIVE_INFINITY : Math.max(...confirmations);
  const unconfirmed = group.flatMap(({ read, stampMs }) =>
    read.stranded === undefined || stampMs <= lastConfirmed ? [] : [read.stranded],
  );
  return {
    ambiguous: identitiesAmbiguous({ group }),
    conflicted,
    label: first.label,
    labels: [...new Set(group.map((entry) => entry.label))],
    read: first.read,
    records: group.length,
    unconfirmed,
  };
}
