/**
 * One node at a time, for `github bump-drive`'s `close-superseded` reads (`./supersedeReads.ts` pages them): each
 * raw GraphQL node becomes a typed pull request, or `undefined` when a field the decision reads is missing,
 * malformed, or about something the read did not ask for. An `undefined` fails the whole read, never shortens it.
 */
import { isRecord } from "../../lib/parsers.js";
import type { MergedRenovatePr, OwnOpenPr, TestMergeReading } from "../../review/bumpSupersede.js";

/** How many changed paths one node carries. A bump that changes more is not judged by its files at all. */
const FILES_PAGE = 100;

/** Every field {@link ownOpenPrOf} reads off one pull request — shared with the close-time re-read. */
export const OWN_PR_FIELDS = `number title url createdAt baseRefName headRefOid mergeable
        repository { nameWithOwner }
        labels(first: 50) { totalCount nodes { name } }
        baseRef { target { ... on Commit { oid tree { oid } } } }
        potentialMergeCommit { tree { oid } parents(first: 3) { totalCount nodes { oid } } }
        files(first: ${String(FILES_PAGE)}) { totalCount nodes { path } }`;

/** A string field, or `undefined`. */
function text({ value, key }: { value: unknown; key: string }): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

/**
 * A commit or tree id: a full 40-character lowercase hex sha, or `undefined`. A malformed id must not compare equal to
 * another malformed one and read as an empty merge.
 */
function oidAt({ value, key }: { value: unknown; key: string }): string | undefined {
  const found = text({ key, value });
  return found !== undefined && /^[0-9a-f]{40}$/u.test(found) ? found : undefined;
}

/**
 * An instant in the shape GitHub's GraphQL sends one, `<date>T<time>Z`, and a real calendar instant — it must
 * read back to the same string, which a normalised `<year>-02-30` does not — or `undefined`.
 */
function instantAt({ value, key }: { value: unknown; key: string }): string | undefined {
  const found = text({ key, value });
  if (found === undefined || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(found)) {
    return undefined;
  }
  const parsed = new Date(found);
  return !Number.isNaN(parsed.getTime()) && `${parsed.toISOString().slice(0, 19)}Z` === found ? found : undefined;
}

/** The oid of `value.tree`. */
function treeOid({ value }: { value: unknown }): string | undefined {
  return isRecord(value) ? oidAt({ key: "oid", value: value["tree"] }) : undefined;
}

/**
 * The test merge's parent oids: empty when GitHub computed no test merge, `undefined` when the connection it gave
 * is truncated or carries a parent with no oid. A malformed parent is never dropped — a review
 * fed `[B, H, null]`, which a filter reads as exactly the two parents a `no-diff` close wants.
 */
function parentOidsOf({ merge }: { merge: unknown }): readonly string[] | undefined {
  if (merge === null) {
    return [];
  }
  const parents = isRecord(merge) ? merge["parents"] : undefined;
  const nodes = isRecord(parents) ? parents["nodes"] : undefined;
  if (!isRecord(parents) || !Array.isArray(nodes) || parents["totalCount"] !== nodes.length) {
    return undefined;
  }
  const oids = nodes.map((parent) => oidAt({ key: "oid", value: parent }));
  return oids.every((oid) => oid !== undefined) ? oids : undefined;
}

/**
 * GitHub's test merge, off one node. A test merge GitHub did not compute is carried as absent, for the pure judge
 * to call unanswerable; one it computed but sent malformed refuses the node, and so fails the read.
 */
function testMergeOf({ node }: { node: Record<string, unknown> }): TestMergeReading | undefined {
  const mergeable = text({ key: "mergeable", value: node });
  const merge = node["potentialMergeCommit"];
  const parentOids = parentOidsOf({ merge });
  if (mergeable === undefined || parentOids === undefined) {
    return undefined;
  }
  const baseRef = node["baseRef"];
  const tip = isRecord(baseRef) ? baseRef["target"] : undefined;
  return {
    baseTipOid: oidAt({ key: "oid", value: tip }),
    baseTipTreeOid: treeOid({ value: tip }),
    mergeTreeOid: treeOid({ value: merge }),
    mergeable,
    parentOids,
  };
}

/** The label names on one node, or `undefined` when the connection is malformed or truncated. */
function labelsOf({ node }: { node: Record<string, unknown> }): readonly string[] | undefined {
  const labels = node["labels"];
  const nodes = isRecord(labels) ? labels["nodes"] : undefined;
  if (!isRecord(labels) || !Array.isArray(nodes) || labels["totalCount"] !== nodes.length) {
    return undefined;
  }
  const names = nodes
    .map((label) => text({ key: "name", value: label }))
    .filter((name): name is string => name !== undefined);
  return names.length === nodes.length ? names : undefined;
}

/**
 * The paths the pull request changes: `past-one-page` when GitHub counts more than one node carries, `undefined`
 * when the connection is malformed, so the node fails rather than reading as a shorter list. A path listed twice
 * is malformed too: a pull request changes each file once, so a repeat would stand in for a file the count holds
 * and the nodes do not.
 */
function changedPathsOf({ node }: { node: Record<string, unknown> }): OwnOpenPr["changedPaths"] | undefined {
  const files = node["files"];
  const nodes = isRecord(files) ? files["nodes"] : undefined;
  const count = isRecord(files) ? files["totalCount"] : undefined;
  if (!Array.isArray(nodes) || typeof count !== "number" || count < nodes.length) {
    return undefined;
  }
  const paths = nodes.map((file) => text({ key: "path", value: file }));
  if (!paths.every((path) => path !== undefined) || new Set(paths).size !== paths.length) {
    return undefined;
  }
  return count > nodes.length ? "past-one-page" : paths;
}

/**
 * Whether a node's `url` is the pull request its own repository and number name. The url is what a comment cites
 * and the close addresses, so a node whose url points elsewhere is malformed rather than evidence.
 */
function urlNames({ url, repoSlug, number }: { url: string; repoSlug: string; number: number }): boolean {
  return url.toLowerCase() === `https://github.com/${repoSlug}/pull/${String(number)}`.toLowerCase();
}

/**
 * One open pull request of the owner's, or `undefined` when a field the decision reads is missing.
 *
 * @param node one raw search node
 * @returns the parsed pull request, or `undefined`
 */
export function ownOpenPrOf({ node }: { node: unknown }): OwnOpenPr | undefined {
  if (!isRecord(node) || typeof node["number"] !== "number") {
    return undefined;
  }
  const repository = node["repository"];
  const fields = {
    baseRefName: text({ key: "baseRefName", value: node }),
    createdAtIso: instantAt({ key: "createdAt", value: node }),
    headOid: oidAt({ key: "headRefOid", value: node }),
    repoSlug: isRecord(repository) ? text({ key: "nameWithOwner", value: repository }) : undefined,
    title: text({ key: "title", value: node }),
    url: text({ key: "url", value: node }),
  };
  const labels = labelsOf({ node });
  const testMerge = testMergeOf({ node });
  const changedPaths = changedPathsOf({ node });
  const { baseRefName, createdAtIso, headOid, repoSlug, title, url } = fields;
  if (
    changedPaths === undefined ||
    baseRefName === undefined ||
    createdAtIso === undefined ||
    headOid === undefined ||
    repoSlug === undefined ||
    title === undefined ||
    url === undefined ||
    labels === undefined ||
    testMerge === undefined
  ) {
    return undefined;
  }
  const number = node["number"];
  if (!urlNames({ number, repoSlug, url })) {
    return undefined;
  }
  return { baseRefName, changedPaths, createdAtIso, headOid, labels, number, repoSlug, testMerge, title, url };
}

/**
 * Whether a merged node is what the search ASKED for: the repository, the Renovate identity (a `Bot` whose login is
 * the app slug, MEASURED off `author { __typename login }` for both identities), and a merge no earlier
 * than the instant. A node that is not is refused, so the read fails rather than closing on another repository's
 * merge.
 */
function mergedAsAsked({
  node,
  repoSlug,
  author,
  sinceIso,
}: {
  node: Record<string, unknown>;
  repoSlug: string;
  author: string;
  sinceIso: string;
}): boolean {
  const repository = node["repository"];
  const by = node["author"];
  const slug = isRecord(repository) ? text({ key: "nameWithOwner", value: repository }) : undefined;
  const login = isRecord(by) && by["__typename"] === "Bot" ? text({ key: "login", value: by }) : undefined;
  const mergedAt = Date.parse(String(node["mergedAt"]));
  return (
    slug?.toLowerCase() === repoSlug.toLowerCase() &&
    login !== undefined &&
    `app/${login}` === author &&
    mergedAt >= Date.parse(`${sinceIso.slice(0, 19)}Z`)
  );
}

/**
 * One merged pull request, or `undefined` when a field the decision reads is missing or the node is not one the
 * search asked for.
 *
 * @param node one raw search node
 * @param repoSlug the repository searched, `owner/name`
 * @param author the Renovate identity searched, `app/<slug>`
 * @param sinceIso the earliest merge instant searched
 * @returns the parsed pull request, or `undefined`
 */
export function mergedPrOf({
  node,
  repoSlug,
  author,
  sinceIso,
}: {
  node: unknown;
  repoSlug: string;
  author: string;
  sinceIso: string;
}): MergedRenovatePr | undefined {
  if (!isRecord(node) || typeof node["number"] !== "number") {
    return undefined;
  }
  if (!mergedAsAsked({ author, node, repoSlug, sinceIso })) {
    return undefined;
  }
  const title = text({ key: "title", value: node });
  const url = text({ key: "url", value: node });
  const baseRefName = text({ key: "baseRefName", value: node });
  const mergedAtIso = instantAt({ key: "mergedAt", value: node });
  if (title === undefined || url === undefined || baseRefName === undefined || mergedAtIso === undefined) {
    return undefined;
  }
  if (!urlNames({ number: node["number"], repoSlug, url })) {
    return undefined;
  }
  return { baseRefName, mergedAtIso, number: node["number"], title, url };
}
