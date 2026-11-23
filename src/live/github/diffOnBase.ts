/**
 * `github read --files`'s current-base receipt: whether an un-merged pull request's diff is ALREADY on its base
 * branch's current tip, read live and stamped with that tip's oid and the instant it was checked. The judgement is
 * `./diffOnBaseJudge.ts`'s, and what it takes from the first read is `./diffOnBaseListed.ts`'s; this is the one GraphQL
 * read it needs and where the answer lands in the document.
 *
 * ## One commit, every file
 *
 * The base files are read through `ref(qualifiedName:).target ... on Commit { file(path:) }`, one alias per changed
 * path, so every blob judged belongs to the one commit whose `oid` the receipt names. Reading `object(expression:
 * "branch:path")` per file instead would resolve the branch once per alias and could judge blobs from two tips.
 *
 * ## The head is bracketed
 *
 * The patches come from the REST file list (`./pullFiles.ts`), read after the pull request itself. This query reads
 * the head oid again, and a head that moved between the first read and this one answers `unknown` — a patch from one
 * head is never certified against another. Two equal oids do not prove the list came from that head: a force-push
 * A→B→A between the reads would hand over B's patches under A's name. So every REST entry must name the head it was
 * diffed at — the `ref` of its `contents_url`, which GitHub sets to the head commit — and that must be the head this
 * query read. The same query also reads the head commit's blob at every listed path, and each must be the `sha` the
 * list carried (a removed file: no blob at all). Any mismatch is the same `unknown`. That blob's text goes to the
 * judge too, which certifies a change only when its post-image is the head's one copy of it.
 *
 * ## A failed read degrades, never discards
 *
 * The files the read already holds are worth more than the receipt. GitHub failing this query, answering no head,
 * or holding no such base branch yields an `unknown` receipt carrying the reason and `baseOid: null`, never an error
 * that would cost the whole `--files` document.
 *
 * ## No ancestry arm
 *
 * A head already reachable from its base is one GitHub itself marks merged, which `lifecycle` already says, so a
 * merged pull request is not checked at all. What this exists for is the change that reached the base ANOTHER way —
 * squashed in a sibling, cherry-picked, rewritten by hand — which only the file contents can show.
 *
 * ## Where it lands
 *
 * `data.diffOnBase` ahead of the CI rollup and `data.diffOnBaseFiles` last, for the reason `./diffOnBaseReceipt.ts`
 * gives.
 */

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { ProviderReadDocument } from "../providerRead.js";
import { type BaseFileSnapshot, type DiffOnBaseFileInput, judgeDiffOnBase } from "./diffOnBaseJudge.js";
import { firstReadHead, type ListedFile, listedFiles } from "./diffOnBaseListed.js";
import { inCutOrder, unreadReceipt, withReceipt } from "./diffOnBaseReceipt.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import { type GithubReadGraphql, parseGithubReadAddress } from "./read.js";

/** The statuses whose path is read from the base; any other is judged `unknown` without a read. */
const READ_STATUSES = new Set(["added", "changed", "modified", "removed"]);

/**
 * The query reading the head again, the head commit's blob oid at every path in `paths`, and the base tip's entry at
 * each of them.
 *
 * @param paths the changed paths, each becoming aliases `h<index>` (head) and `f<index>` (base) over `$p<index>`
 * @returns the GraphQL document
 */
export function diffOnBaseQuery({ paths }: { paths: readonly string[] }): string {
  const declarations = paths.map((_, index) => `, $p${String(index)}: String!`).join("");
  const headAliases = paths
    .map(
      (_, index) =>
        `            h${String(index)}: file(path: $p${String(index)}) ` +
        "{ oid mode object { __typename ... on Blob { text isBinary isTruncated } } }",
    )
    .join("\n");
  const aliases = paths
    .map(
      (_, index) =>
        `          f${String(index)}: file(path: $p${String(index)}) ` +
        "{ mode object { __typename ... on Blob { text isBinary isTruncated } } }",
    )
    .join("\n");
  return [
    `query SlopweaverDiffOnBase($owner: String!, $repo: String!, $number: Int!, $base: String!${declarations}) {`,
    "  repository(owner: $owner, name: $repo) {",
    "    pullRequest(number: $number) {",
    "      baseRefName",
    "      headRefOid",
    "      commits(last: 1) {",
    "        nodes {",
    "          commit {",
    "            oid",
    headAliases,
    "          }",
    "        }",
    "      }",
    "    }",
    "    ref(qualifiedName: $base) {",
    "      target {",
    "        __typename",
    "        oid",
    "        ... on Commit {",
    aliases,
    "        }",
    "      }",
    "    }",
    "  }",
    "}",
  ].join("\n");
}

/** What one aliased tree entry holds — the base tip's, or the head's — named in each reason by `side`. */
function snapshotOf({ entry, side }: { entry: unknown; side: "base" | "head" }): BaseFileSnapshot {
  if (entry === null) {
    return { kind: "missing" };
  }
  if (entry === undefined) {
    return { kind: "unread", reason: "GitHub answered nothing for that path" };
  }
  const object = isRecord(entry) ? entry["object"] : undefined;
  if (!isRecord(object) || object["__typename"] !== "Blob") {
    return { kind: "unread", reason: `the ${side} holds something other than a file at that path` };
  }
  if (object["isBinary"] !== false) {
    return { kind: "unread", reason: `the ${side}'s copy is binary` };
  }
  if (object["isTruncated"] !== false || typeof object["text"] !== "string") {
    return { kind: "unread", reason: `GitHub cut the ${side}'s copy short` };
  }
  return { kind: "text", text: object["text"] };
}

/** Why a path's file mode cannot be judged equal on both sides, or `undefined` when GitHub gave the same one for each. */
function modeReason({ baseEntry, headEntry }: { baseEntry: unknown; headEntry: unknown }): string | undefined {
  const baseMode = isRecord(baseEntry) ? baseEntry["mode"] : undefined;
  const headMode = isRecord(headEntry) ? headEntry["mode"] : undefined;
  if (typeof baseMode !== "number" || typeof headMode !== "number") {
    return "GitHub answered no file mode for it";
  }
  if (baseMode !== headMode) {
    return `the base holds it as mode ${baseMode.toString(8)}, the head as ${headMode.toString(8)}`;
  }
  return undefined;
}

/** A read failure naming the pull request and what was missing. */
function refused({ identity, what }: { identity: string; what: string }): GithubLiveError {
  return GithubLiveErrors.readFailed({ message: `the current-base check of ${identity} ${what}` });
}

/** The head commit this query read, from `pullRequest.commits(last: 1)`. */
function headCommitOf({ pull }: { pull: unknown }): Readonly<Record<string, unknown>> | undefined {
  const commits = isRecord(pull) ? pull["commits"] : undefined;
  const nodes = isRecord(commits) ? commits["nodes"] : undefined;
  const last: unknown = Array.isArray(nodes) ? nodes.at(-1) : undefined;
  const commit = isRecord(last) ? last["commit"] : undefined;
  return isRecord(commit) ? commit : undefined;
}

/**
 * True when every read file's blob on the head commit is the one the file list carried — the list was read from the
 * head being certified. A removed file has no blob on the head.
 */
function listIsFromHead({
  files,
  headCommit,
}: {
  files: readonly ListedFile[];
  headCommit: Readonly<Record<string, unknown>>;
}): boolean {
  return files.every((file, index) => {
    const entry = headCommit[`h${String(index)}`];
    if (file.status === "removed") {
      return entry === null;
    }
    return file.sha !== undefined && isRecord(entry) && entry["oid"] === file.sha;
  });
}

/** The check query's variables: the pull request, its base by full ref, and one `$p<index>` per read path. */
function checkVariables({
  target,
  baseRef,
  read,
}: {
  target: { readonly owner: string; readonly repo: string; readonly number: number };
  baseRef: string;
  read: readonly ListedFile[];
}): Record<string, unknown> {
  const variables: Record<string, unknown> = {
    // Qualified in full, so a branch whose own name starts `refs/heads/` is never read as another.
    base: `refs/heads/${baseRef}`,
    number: target.number,
    owner: target.owner,
    repo: target.repo,
  };
  for (const [index, file] of read.entries()) {
    variables[`p${String(index)}`] = file.filename;
  }
  return variables;
}

/** The base tip's commit, with the oid the receipt names. */
type BaseCommit = Readonly<Record<string, unknown>> & { readonly oid: string };

/** True when the base ref's target is a commit with an oid. */
function isBaseCommit(value: unknown): value is BaseCommit {
  return isRecord(value) && value["__typename"] === "Commit" && typeof value["oid"] === "string";
}

/** The two commits the check answered, or why it cannot be judged. */
type AnsweredCommits =
  | {
      readonly kind: "answered";
      readonly baseCommit: BaseCommit;
      readonly headCommit: Readonly<Record<string, unknown>>;
      readonly headNow: string;
    }
  | { readonly kind: "degraded"; readonly reason: string };

/** The head and base commits out of the check's answer, still on the base the first read named. */
function answeredCommits({ value, baseRef }: { value: unknown; baseRef: string }): AnsweredCommits {
  const repository = isRecord(value) ? value["repository"] : undefined;
  const pull = isRecord(repository) ? repository["pullRequest"] : undefined;
  const ref = isRecord(repository) ? repository["ref"] : undefined;
  const commit = isRecord(ref) ? ref["target"] : undefined;
  const headNow = isRecord(pull) ? pull["headRefOid"] : undefined;
  const headCommit = headCommitOf({ pull });
  if (typeof headNow !== "string" || headCommit === undefined) {
    return { kind: "degraded", reason: "GitHub answered no head commit for it" };
  }
  // The base was named by the first read, so a retarget between the two reads would judge the branch it left.
  if (!isRecord(pull) || pull["baseRefName"] !== baseRef) {
    return { kind: "degraded", reason: "the pull request's base changed while it was read — read it again" };
  }
  if (!isBaseCommit(commit)) {
    return { kind: "degraded", reason: `GitHub found no branch ${baseRef} to read` };
  }
  return { baseCommit: commit, headCommit, headNow, kind: "answered" };
}

/** Each listed file with what the base tip and the head hold at its path, the read paths in alias order. */
function fileInputs({
  files,
  baseCommit,
  headCommit,
}: {
  files: readonly ListedFile[];
  baseCommit: Readonly<Record<string, unknown>>;
  headCommit: Readonly<Record<string, unknown>>;
}): DiffOnBaseFileInput[] {
  let readIndex = 0;
  return files.map((file): DiffOnBaseFileInput => {
    // A status the judge cannot use is never read; it answers `unknown` on its status alone.
    let base: BaseFileSnapshot = { kind: "unread", reason: `GitHub calls it ${file.status}` };
    let head: BaseFileSnapshot = base;
    if (READ_STATUSES.has(file.status)) {
      const baseEntry = baseCommit[`f${String(readIndex)}`];
      const headEntry = headCommit[`h${String(readIndex)}`];
      base = snapshotOf({ entry: baseEntry, side: "base" });
      head = snapshotOf({ entry: headEntry, side: "head" });
      readIndex += 1;
      // A blob's oid and text leave out its file mode, so an executable bit or a symlink the head changes reads the
      // same as the base's copy; without the merge base's mode either side may have changed it.
      const modeDiffers = modeReason({ baseEntry, headEntry });
      if (base.kind === "text" && head.kind === "text" && modeDiffers !== undefined) {
        base = { kind: "unread", reason: modeDiffers };
      }
    }
    return { base, filename: file.filename, head, patch: file.patch, status: file.status };
  });
}

/** True when the head the patches were diffed at is not, provably, the head this check read. */
function headMovedBetween({
  data,
  files,
  read,
  headCommit,
  headNow,
}: {
  data: Readonly<Record<string, unknown>>;
  files: readonly ListedFile[];
  /** The listed files whose paths the check read, in alias order. */
  read: readonly ListedFile[];
  headCommit: Readonly<Record<string, unknown>>;
  headNow: string;
}): boolean {
  return (
    firstReadHead({ data }) !== headNow ||
    headCommit["oid"] !== headNow ||
    !files.every((file) => file.diffedAt === headNow) ||
    !listIsFromHead({ files: read, headCommit })
  );
}

/**
 * Add the current-base receipt to a pull request's `--files` read. A merged pull request is returned unchanged:
 * its lifecycle already says where its change is.
 *
 * @param document the read `./pullFiles.ts` produced, with `data.files`
 * @param graphql the safe-wrapped GraphQL seam
 * @param nowIso the clock stamping `checkedAtIso` once the base has been read
 * @returns the document with `data.diffOnBase` — `unknown` with its reason when GitHub could not answer — and each
 *   file's own answer at `data.diffOnBaseFiles`, or a named
 *   failure only when the document is not a pull request's `--files` read
 */
export async function withDiffOnBase({
  document,
  graphql,
  nowIso,
}: {
  document: ProviderReadDocument;
  graphql: GithubReadGraphql;
  nowIso: () => string;
}): Promise<Result<ProviderReadDocument, GithubLiveError>> {
  const parsed = parseGithubReadAddress({ address: document.target.address });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const target = parsed.value;
  const data = document.data;
  if (target.kind !== "pull-request" || !isRecord(data)) {
    return err(refused({ identity: target.identity, what: "needs a pull request's read" }));
  }
  if (data["merged"] === true) {
    return ok(document);
  }
  const baseRef = data["baseRefName"];
  const listed = listedFiles({ data });
  if (typeof baseRef !== "string" || listed === undefined) {
    return err(refused({ identity: target.identity, what: "found no base branch or file list in the read" }));
  }
  const read = listed.files.filter((file) => READ_STATUSES.has(file.status));
  // A path a side does not hold is a NOT_FOUND beside a `null` alias, which is the answer, not a failed read.
  const response = await graphql({
    missingFileReadsNull: true,
    query: diffOnBaseQuery({ paths: read.map((file) => file.filename) }),
    variables: checkVariables({ baseRef, read, target }),
  });
  const degraded = ({ reason }: { reason: string }): ProviderReadDocument => ({
    ...document,
    data: withReceipt({ data, files: [], receipt: unreadReceipt({ baseRef, checkedAtIso: nowIso(), reason }) }),
  });
  if (response.isErr()) {
    return ok(degraded({ reason: `GitHub did not answer the check: ${response.error.message}` }));
  }
  const answer = answeredCommits({ baseRef, value: response.value });
  if (answer.kind === "degraded") {
    return ok(degraded({ reason: answer.reason }));
  }
  const { baseCommit, headCommit, headNow } = answer;
  const inputs = fileInputs({ baseCommit, files: listed.files, headCommit });
  const headMoved = headMovedBetween({ data, files: listed.files, headCommit, headNow, read });
  const judgement = judgeDiffOnBase({ fileListComplete: listed.complete, files: inputs, headMoved });
  const receipt = inCutOrder({
    receipt: {
      baseOid: baseCommit.oid,
      baseRef,
      checkedAtIso: nowIso(),
      verdict: judgement.verdict,
      ...(judgement.reason === undefined ? {} : { reason: judgement.reason }),
    },
  });
  return ok({ ...document, data: withReceipt({ data, files: judgement.files, receipt }) });
}
