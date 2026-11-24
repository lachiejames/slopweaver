/**
 * Whether a description already reviewed CLEAN may be written again over a change set that moved since, with no
 * fresh review: the pure half.
 *
 * A receipt binds the exact change set (`./descriptionChangeDigest.ts`), so any content edit used to ask for a new
 * review even when every byte of the description was the same. A description is not reviewed again when nothing
 * material changed, so an earlier CLEAN receipt is CARRIED when, and only when, all of these hold:
 *
 * - every other input it bound (repository, base, title, body, both comment sets, images, rules) is byte-identical;
 * - the reviewed and current change sets touch exactly the same paths, each with the same status, both modes and the
 *   same base-side blob, so nothing was added, dropped, renamed, re-moded, or moved under the branch by its base;
 * - every path whose content differs ends in `.md`, sits outside the trees a description could be judged against
 *   ({@link JUDGED_TREES}), and is never named (full path or file name, any case) in the title, body, outgoing
 *   comments or image proves lines.
 *
 * Anything else, including any doubt about the reviewed change set, asks for a fresh review.
 *
 * ## The blind spot, chosen
 *
 * No syntactic rule can tell whether trimmed prose was what a claim rested on. A description that says "the
 * reference documents three retries" without naming the file stays CLEAN after the sentence establishing it is
 * trimmed. That one case is accepted, stated in {@link CARRIED_REVIEW_BLIND_SPOT}, printed on every carried write
 * and pinned by name in this module's unit test; nothing else rides.
 */
import type { TreeDeltaEntry } from "./descriptionChangeDigest.js";
import { manifestSha256Of } from "./descriptionReview.js";
import type { DescriptionReviewManifest } from "./descriptionReviewTypes.js";

/**
 * The trees holding text a description could be judged against. A changed Markdown file under one of them always
 * asks for a fresh review. Every `DESCRIPTION_RULE_FILES` entry (`./descriptionReviewTypes.ts`) sits under one; a
 * unit test holds that.
 */
export const JUDGED_TREES: readonly string[] = ["skills/", ".claude/rules/"];

/** The residue every carried write states, in plain words. */
export const CARRIED_REVIEW_BLIND_SPOT =
  "a claim about prose in a changed Markdown file the description never names can ride this earlier review unread";

/** The authored text a description's claims are made in: what a changed path must not be named in. */
export interface DescriptionClaimText {
  readonly title: string;
  readonly body: string;
  /** The bodies of the inline comments the same write posts. */
  readonly commentBodies: readonly string[];
  /** Each image's proves line. */
  readonly imageProofs: readonly string[];
}

/** Carry the earlier review over these changed paths, or review again for these reasons. */
export type DescriptionMaterialityDecision =
  | { readonly kind: "carry"; readonly changedPaths: readonly string[] }
  | { readonly kind: "review"; readonly reasons: readonly string[] };

/**
 * Whether two manifests bind the same description, every input but the change set compared byte for byte.
 *
 * @param want the manifest the write would send
 * @param reviewed the manifest an earlier receipt bound
 * @returns true when only `changeDigest` may differ
 */
export function sameDescriptionInputs({
  want,
  reviewed,
}: {
  want: DescriptionReviewManifest;
  reviewed: DescriptionReviewManifest;
}): boolean {
  // Compared through the manifest digest with the change set blanked, so a field added to the manifest later is
  // compared too without this function having to learn its name.
  return (
    manifestSha256Of({ manifest: { ...want, changeDigest: "" } }) ===
    manifestSha256Of({ manifest: { ...reviewed, changeDigest: "" } })
  );
}

/** Whether a path's base side, status or mode differs between the two readings. */
function shapeMoved({ reviewed, current }: { reviewed: TreeDeltaEntry; current: TreeDeltaEntry }): boolean {
  return (
    reviewed.status !== current.status ||
    reviewed.oldMode !== current.oldMode ||
    reviewed.newMode !== current.newMode ||
    reviewed.oldBlob !== current.oldBlob
  );
}

/** Whether the claim text names a path, by its full path or its file name, in any case. */
function namedInClaims({ path, claims }: { path: string; claims: DescriptionClaimText }): boolean {
  const text = [claims.title, claims.body, ...claims.commentBodies, ...claims.imageProofs].join("\n").toLowerCase();
  const fileName = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  return text.includes(path.toLowerCase()) || text.includes(fileName);
}

/**
 * Why a path whose content changed since the review asks for a fresh one.
 *
 * @returns the reason, or undefined when the change may ride the earlier review
 */
function contentChangeReason({ path, claims }: { path: string; claims: DescriptionClaimText }): string | undefined {
  if (!path.endsWith(".md")) {
    return `${path} changed and is not Markdown`;
  }
  if (JUDGED_TREES.some((tree) => path.startsWith(tree))) {
    return `${path} changed and holds text a description is judged against`;
  }
  if (namedInClaims({ claims, path })) {
    return `${path} changed and the description names it`;
  }
  return undefined;
}

/** One path both readings touch: whether its content changed, and why that asks for a fresh review if it does. */
function judgePath({
  reviewed,
  current,
  claims,
}: {
  reviewed: TreeDeltaEntry;
  current: TreeDeltaEntry;
  claims: DescriptionClaimText;
}): { readonly changed: boolean; readonly reason: string | undefined } {
  if (shapeMoved({ current, reviewed })) {
    return { changed: false, reason: `${current.path}'s status, mode or base-side content moved` };
  }
  if (reviewed.newBlob === current.newBlob) {
    return { changed: false, reason: undefined };
  }
  return { changed: true, reason: contentChangeReason({ claims, path: current.path }) };
}

/** The reasons the two path sets differ: one per path only one side touches. */
function pathSetReasons({
  reviewed,
  current,
}: {
  reviewed: ReadonlyMap<string, TreeDeltaEntry>;
  current: ReadonlyMap<string, TreeDeltaEntry>;
}): readonly string[] {
  const added = [...current.keys()].filter((path) => !reviewed.has(path));
  const dropped = [...reviewed.keys()].filter((path) => !current.has(path));
  return [
    ...added.toSorted().map((path) => `the change set now also touches ${path}`),
    ...dropped.toSorted().map((path) => `the change set no longer touches ${path}`),
  ];
}

/**
 * Decide whether a change set that moved since a CLEAN review is material to the unchanged description.
 *
 * @param reviewedEntries the tree delta the earlier review read, recovered from its packet
 * @param currentEntries the tree delta the write would send
 * @param claims the description's authored text, which a changed path must not be named in
 * @returns carry, with the changed paths in order; or review, with every reason found
 */
export function decideDescriptionMateriality({
  reviewedEntries,
  currentEntries,
  claims,
}: {
  reviewedEntries: readonly TreeDeltaEntry[];
  currentEntries: readonly TreeDeltaEntry[];
  claims: DescriptionClaimText;
}): DescriptionMaterialityDecision {
  const reviewed = new Map(reviewedEntries.map((entry) => [entry.path, entry]));
  const current = new Map(currentEntries.map((entry) => [entry.path, entry]));
  const reasons = [...pathSetReasons({ current, reviewed })];
  const changedPaths: string[] = [];
  const ordered = [...current.values()].toSorted((left, right) =>
    left.path < right.path ? -1 : Number(left.path > right.path),
  );
  for (const now of ordered) {
    const before = reviewed.get(now.path);
    if (before === undefined) {
      continue;
    }
    const judged = judgePath({ claims, current: now, reviewed: before });
    if (judged.changed) {
      changedPaths.push(now.path);
    }
    if (judged.reason !== undefined) {
      reasons.push(judged.reason);
    }
  }
  if (reasons.length > 0) {
    return { kind: "review", reasons };
  }
  if (changedPaths.length === 0) {
    return { kind: "review", reasons: ["no path's content differs from the reviewed change set"] };
  }
  return { changedPaths, kind: "carry" };
}

/**
 * The one line a carried write prints, naming the receipt it rode, the paths that moved and the blind spot.
 *
 * @param receiptId the earlier CLEAN receipt the write rides
 * @param changedPaths the Markdown paths whose content changed since it
 * @returns the line
 */
export function carriedReviewNotice({
  receiptId,
  changedPaths,
}: {
  receiptId: string;
  changedPaths: readonly string[];
}): string {
  return (
    `description review: the description is unchanged, so CLEAN receipt ${receiptId} still covers it over a change ` +
    `set that moved only in ${changedPaths.join(", ")}. Blind spot: ${CARRIED_REVIEW_BLIND_SPOT}.`
  );
}
