/**
 * The contents half of `github exposure sweep`: the bytes of every file version the repository's history holds.
 *
 * ## Diffs first, then every blob no diff covered
 *
 * Every line a file version holds was ADDED by some reachable commit, so the added lines of every commit's patch
 * are every line of every version, each read once. That costs one listing per commit rather than one read per blob
 * (measured on this repository: 123 commits against 22,873 distinct blobs).
 *
 * A diff does not always come back whole. GitHub lists at most 3,000 files of one commit (this repository's root
 * commit has 21,516: `git log --all --format=%h --shortstat | grep -B2 -E "^ [0-9]{4,} files"`), omits the patch of
 * a binary or an over-large diff, and a listing can fail. So the argument is by the commit that INTRODUCED each line:
 * - its file came with a patch there, and the line is in that scanned patch;
 * - its file came without one, so that blob is read whole — even when another commit's patch also produced it, since
 *   that patch shows only its own additions;
 * - or that commit's list came back failed or cut off, so every blob in its root tree is read whole.
 * Every blob of the tree walk that no patch produced is read whole as well. Reads go through GraphQL, fifty to a
 * query, and over REST when GitHub cuts the text off or calls it binary. A binary blob is scanned on its printable
 * runs, the way `strings` reads one, because a token pasted into a binary is still a token.
 *
 * Each added line keeps its line number in the new file, so a finding's locator is `commit <sha> file <path>` or
 * `blob <sha> file <path>` and a real line. Gaps are counts: a printed gap never names a commit or path.
 */

import { isRecord } from "../../lib/parsers.js";
import { countingSeam, type GithubExposureSeam, listAll, stringAt } from "./exposureListing.js";
import { GITHUB_EXPOSURE_BLOB_BATCH, githubExposureBlobsQuery } from "./exposureModel.js";
import type { GithubExposureText } from "./exposureTexts.js";

/** How many leading bytes are checked for a NUL to call a blob binary — git's own heuristic. */
const BINARY_SNIFF_BYTES = 8000;

/** A printable run shorter than this is noise in a binary, as `strings` treats it. */
const PRINTABLE_RUN = /[\x20-\x7e]{8,}/gu;

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u;

/**
 * The lines a patch adds, each at its line number in the new file and every other line blank. Pure.
 *
 * A context line advances the new file's numbering and is left blank (it was added by an earlier commit and scanned
 * there); a removed line does not exist in the new file; `\ No newline at end of file` is git's note, not content.
 *
 * @param patch one file's unified-diff patch as GitHub returns it
 * @returns a text whose line N is the new file's line N when this patch added it, else empty
 */
export function addedLinesText({ patch }: { patch: string }): string {
  const lines: string[] = [];
  let next = 0;
  for (const raw of patch.split("\n")) {
    const hunk = HUNK_HEADER.exec(raw);
    if (hunk !== null) {
      next = Number(hunk[1]);
      continue;
    }
    if (next === 0 || raw.startsWith("\\") || raw.startsWith("-")) {
      continue;
    }
    if (raw.startsWith("+")) {
      while (lines.length < next - 1) {
        lines.push("");
      }
      lines.push(raw.slice(1));
    }
    next += 1;
  }
  return lines.join("\n");
}

/**
 * A blob's text: its UTF-8 when it is text, its printable runs one per line when it is binary. Pure.
 *
 * @param bytes the blob's decoded bytes
 * @returns the text to scan, and whether the blob was binary
 */
export function blobScanText({ bytes }: { bytes: Buffer }): { text: string; binary: boolean } {
  if (!bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
    return { binary: false, text: bytes.toString("utf8") };
  }
  return { binary: true, text: [...bytes.toString("latin1").matchAll(PRINTABLE_RUN)].map((run) => run[0]).join("\n") };
}

/** What the contents stage read and could not read. */
export interface GithubExposureContentsReading {
  readonly calls: number;
  readonly gaps: readonly string[];
}

/** One blob's text as a scan input. */
function blobText({ sha, path, text, binary }: { sha: string; path: string; text: string; binary: boolean }): {
  texts: readonly GithubExposureText[];
} {
  return {
    texts: [
      {
        field: binary ? "printable runs" : "content",
        locator: `blob ${sha} file ${path}`,
        surface: "file-history",
        text,
      },
    ],
  };
}

/** Read one blob over REST and hand its text over; false when it could not be read. */
async function readBlobOverRest({
  seam,
  owner,
  repo,
  sha,
  path,
  take,
}: {
  seam: GithubExposureSeam;
  owner: string;
  repo: string;
  sha: string;
  path: string;
  take: (args: { texts: readonly GithubExposureText[] }) => void;
}): Promise<boolean> {
  const read = await seam.get({ call: "git-blob", params: { file_sha: sha, owner, repo } });
  const content = read.isOk() && isRecord(read.value) ? read.value["content"] : undefined;
  if (typeof content !== "string") {
    return false;
  }
  take(blobText({ path, sha, ...blobScanText({ bytes: Buffer.from(content, "base64") }) }));
  return true;
}

/** The blobs one GraphQL answer carried as text, and the ones to read again over REST. */
function blobAnswer({ data, batch }: { data: unknown; batch: readonly (readonly [string, string])[] }): {
  read: readonly { sha: string; path: string; text: string }[];
  again: readonly (readonly [string, string])[];
} {
  const repository = isRecord(data) ? data["repository"] : undefined;
  const read: { sha: string; path: string; text: string }[] = [];
  const again: (readonly [string, string])[] = [];
  batch.forEach(([sha, path], index) => {
    const blob = isRecord(repository) ? repository[`b${String(index)}`] : undefined;
    const text = isRecord(blob) ? blob["text"] : undefined;
    if (isRecord(blob) && blob["isTruncated"] !== true && blob["isBinary"] !== true && typeof text === "string") {
      read.push({ path, sha, text });
    } else {
      again.push([sha, path]);
    }
  });
  return { again, read };
}

/**
 * Every blob in one commit's root tree, read recursively; undefined when the tree is unknown, unreadable or cut off.
 */
async function commitTreeBlobs({
  seam,
  owner,
  repo,
  sha,
  commitTrees,
}: {
  seam: GithubExposureSeam;
  owner: string;
  repo: string;
  sha: string;
  commitTrees: ReadonlyMap<string, string>;
}): Promise<ReadonlyMap<string, string> | undefined> {
  const treeSha = commitTrees.get(sha);
  if (treeSha === undefined) {
    return undefined;
  }
  const read = await seam.get({ call: "git-tree", params: { owner, recursive: "1", repo, tree_sha: treeSha } });
  if (read.isErr() || !isRecord(read.value) || read.value["truncated"] === true || !Array.isArray(read.value["tree"])) {
    return undefined;
  }
  const blobs = new Map<string, string>();
  for (const entry of read.value["tree"]) {
    const blobSha = stringAt({ path: ["sha"], value: entry });
    const path = stringAt({ path: ["path"], value: entry });
    if (stringAt({ path: ["type"], value: entry }) === "blob" && blobSha !== undefined && path !== undefined) {
      blobs.set(blobSha, path);
    }
  }
  return blobs;
}

/**
 * Read every file version every listed commit added, handing each text to `take`.
 *
 * @param seam the read seam
 * @param owner the repository owner
 * @param repo the repository name
 * @param commitShas every distinct commit the inventory listed
 * @param treeBlobs every distinct blob the inventory's tree walk saw, with the first path it was seen at
 * @param commitTrees each listed commit's root tree, to re-read whole when its file list comes back in part
 * @param maxPages the page ceiling per commit's file list
 * @param take scans one text, once per distinct text
 * @returns how many reads it made, and every gap as a count
 */
export async function readGithubExposureContents({
  seam,
  owner,
  repo,
  commitShas,
  treeBlobs,
  commitTrees,
  maxPages,
  take,
}: {
  seam: GithubExposureSeam;
  owner: string;
  repo: string;
  commitShas: readonly string[];
  treeBlobs: ReadonlyMap<string, string>;
  commitTrees: ReadonlyMap<string, string>;
  maxPages: number;
  take: (args: { texts: readonly GithubExposureText[] }) => void;
}): Promise<GithubExposureContentsReading> {
  const counter = countingSeam({ seam });
  const pass: PatchPass = { covered: new Set(), mustRead: new Map(), unknownTrees: 0 };
  for (const sha of commitShas) {
    await readCommitPatches({ commitTrees, maxPages, owner, pass, repo, seam: counter.seam, sha, take });
  }
  const toRead = [
    ...[...treeBlobs].filter(([blobSha]) => !pass.covered.has(blobSha) && !pass.mustRead.has(blobSha)),
    ...pass.mustRead,
  ];
  const unread = await readBlobs({ owner, repo, seam: counter.seam, take, toRead });
  return { calls: counter.calls(), gaps: contentsGaps({ unknownTrees: pass.unknownTrees, unread }) };
}

/** What the patch pass learned across every commit. */
interface PatchPass {
  /** Every blob a patch's added lines covered. */
  readonly covered: Set<string>;
  /** Read whole however many patches also produced it: its own commit introduced lines no patch showed. */
  readonly mustRead: Map<string, string>;
  /** Commits listed in part whose root tree could not be read whole either. */
  unknownTrees: number;
}

/** Read one commit's file list: each patch's added lines to `take`, and what must be read whole instead. */
async function readCommitPatches({
  seam,
  owner,
  repo,
  sha,
  commitTrees,
  maxPages,
  pass,
  take,
}: {
  seam: GithubExposureSeam;
  owner: string;
  repo: string;
  sha: string;
  commitTrees: ReadonlyMap<string, string>;
  maxPages: number;
  pass: PatchPass;
  take: (args: { texts: readonly GithubExposureText[] }) => void;
}): Promise<void> {
  const listing = await listAll({ call: "commit-detail", maxPages, params: { owner, ref: sha, repo }, seam });
  if (listing.outcome !== "complete") {
    const tree = await commitTreeBlobs({ commitTrees, owner, repo, seam, sha });
    markTreeRead({ pass, tree });
  }
  for (const file of listing.items) {
    takePatch({ file, pass, sha, take });
  }
}

/** A commit listed in part: every blob of its root tree to read whole, or counted when that tree is unknown too. */
function markTreeRead({ pass, tree }: { pass: PatchPass; tree: ReadonlyMap<string, string> | undefined }): void {
  if (tree === undefined) {
    pass.unknownTrees += 1;
    return;
  }
  for (const [blobSha, path] of tree) {
    pass.mustRead.set(blobSha, path);
  }
}

/** One listed file: its added lines scanned and its blob covered, or its blob marked to read whole. */
function takePatch({
  file,
  sha,
  pass,
  take,
}: {
  file: unknown;
  sha: string;
  pass: PatchPass;
  take: (args: { texts: readonly GithubExposureText[] }) => void;
}): void {
  const path = stringAt({ path: ["filename"], value: file });
  const patch = stringAt({ path: ["patch"], value: file });
  const blobSha = stringAt({ path: ["sha"], value: file });
  // A removal's patch carries only `-` lines and its `sha` is the version removed, which it never covers.
  if (path === undefined || blobSha === undefined || stringAt({ path: ["status"], value: file }) === "removed") {
    return;
  }
  if (patch === undefined) {
    pass.mustRead.set(blobSha, path);
    return;
  }
  pass.covered.add(blobSha);
  const text = addedLinesText({ patch });
  take({ texts: [{ field: "patch", locator: `commit ${sha} file ${path}`, surface: "file-history", text }] });
}

/** Read every listed blob whole, a GraphQL batch at a time and over REST what GraphQL gave no text for. */
async function readBlobs({
  seam,
  owner,
  repo,
  toRead,
  take,
}: {
  seam: GithubExposureSeam;
  owner: string;
  repo: string;
  toRead: readonly (readonly [string, string])[];
  take: (args: { texts: readonly GithubExposureText[] }) => void;
}): Promise<number> {
  let unread = 0;
  for (let start = 0; start < toRead.length; start += GITHUB_EXPOSURE_BLOB_BATCH) {
    const batch = toRead.slice(start, start + GITHUB_EXPOSURE_BLOB_BATCH);
    const variables: Record<string, string> = { owner, repo };
    batch.forEach(([blobSha], index) => {
      variables[`o${String(index)}`] = blobSha;
    });
    const answer = await seam.graphql({ query: githubExposureBlobsQuery({ count: batch.length }), variables });
    const { read, again } = answer.isOk() ? blobAnswer({ batch, data: answer.value }) : { again: batch, read: [] };
    for (const blob of read) {
      take(blobText({ ...blob, binary: false }));
    }
    for (const [blobSha, path] of again) {
      const readBack = await readBlobOverRest({ owner, path, repo, seam, sha: blobSha, take });
      unread += readBack ? 0 : 1;
    }
  }
  return unread;
}

/** The contents stage's gaps, as counts. */
function contentsGaps({ unknownTrees, unread }: { unknownTrees: number; unread: number }): readonly string[] {
  const gaps: string[] = [];
  if (unknownTrees > 0) {
    gaps.push(`${String(unknownTrees)} commit(s) listed in part had a tree that could not be read whole`);
  }
  if (unread > 0) {
    gaps.push(`${String(unread)} file version(s) no patch covered could not be read`);
  }
  return gaps;
}
