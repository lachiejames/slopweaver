/**
 * What the current-base check takes from the FIRST read — the REST file list `./pullFiles.ts` wrote and the head that
 * read judged — before `./diffOnBase.ts` reads the base. Each entry keeps the head it was diffed at and its head blob,
 * so the check can prove the patches came from the head it certifies.
 */

import { isRecord } from "../../lib/parsers.js";

/** The most files GitHub's pull-request file list ever returns, whatever the pull request changes. */
export const PULL_FILES_MAX = 3000;

/** One changed file as the REST list carried it. */
export interface ListedFile {
  readonly filename: string;
  readonly status: string;
  readonly patch: string | undefined;
  /** The file's blob at the head the list was read from. */
  readonly sha: string | undefined;
  /** The head commit GitHub diffed this entry at: the `ref` its `contents_url` names. */
  readonly diffedAt: string | undefined;
}

/**
 * The `ref` a REST entry's `contents_url` names: the head commit GitHub diffed that entry at.
 *
 * @param contentsUrl the entry's raw `contents_url`
 * @returns the head it names, or `undefined` when it names none
 */
export function diffedAtOf({ contentsUrl }: { contentsUrl: unknown }): string | undefined {
  if (typeof contentsUrl !== "string" || !URL.canParse(contentsUrl)) {
    return undefined;
  }
  const ref = new URL(contentsUrl).searchParams.get("ref");
  if (ref === null) {
    return undefined;
  }
  return ref;
}

/** One REST file-list entry, or `undefined` when it is not the shape `./pullFiles.ts` writes. */
function listedFile({ node }: { node: unknown }): ListedFile | undefined {
  if (!isRecord(node) || typeof node["filename"] !== "string" || typeof node["status"] !== "string") {
    return undefined;
  }
  const patch = node["patch"];
  if (patch !== undefined && patch !== null && typeof patch !== "string") {
    return undefined;
  }
  const sha = node["sha"];
  return {
    diffedAt: diffedAtOf({ contentsUrl: node["contents_url"] }),
    filename: node["filename"],
    patch: typeof patch === "string" ? patch : undefined,
    sha: typeof sha === "string" ? sha : undefined,
    status: node["status"],
  };
}

/**
 * The changed files at `data.files`, and whether the list is whole.
 *
 * @param data the pull request's `--files` read, its `files` connection and `changedFiles` count included
 * @returns the entries with `complete` true only when every count GitHub gave agrees, no file is listed twice, every
 *   entry naming a head names the read's own and the list is short of GitHub's cap, or `undefined` when the list is
 *   not the shape `./pullFiles.ts` writes
 */
export function listedFiles({
  data,
}: {
  data: Readonly<Record<string, unknown>>;
}): { readonly files: readonly ListedFile[]; readonly complete: boolean } | undefined {
  const connection = data["files"];
  if (!isRecord(connection) || !Array.isArray(connection["nodes"]) || !isRecord(connection["pageInfo"])) {
    return undefined;
  }
  const hasNextPage = connection["pageInfo"]["hasNextPage"];
  if (typeof hasNextPage !== "boolean") {
    return undefined;
  }
  const files: ListedFile[] = [];
  for (const node of connection["nodes"] as readonly unknown[]) {
    const file = listedFile({ node });
    if (file === undefined) {
      return undefined;
    }
    files.push(file);
  }
  // A list is whole only when every count GitHub gave for it agrees with what it holds: a last page that says so,
  // the connection's own total, and the pull request's changed-file count when it carries one. A list
  // at GitHub's cap never is, since GitHub answers that many for a list it cut and the counts agree either way
  //. Nor is one naming a file twice: pages shifted between reads, so a count that agrees hides one file
  // the list skipped for each it repeated. Nor is one diffed at two heads: a push between its pages
  // splices two lists whose names and count can still agree, and one diffed at another head than the read's own was
  // counted against a different pull request.
  const totalCount = connection["totalCount"];
  const changedFiles = data["changedFiles"];
  const countsAgree =
    totalCount === files.length && (typeof changedFiles !== "number" || changedFiles === files.length);
  const distinct = new Set(files.map((file) => file.filename)).size === files.length;
  const heads = new Set(files.flatMap((file) => (file.diffedAt === undefined ? [] : [file.diffedAt])));
  const readHead = firstReadHead({ data });
  const oneHead = heads.size <= 1 && (readHead === undefined || [...heads].every((head) => head === readHead));
  return { complete: !hasNextPage && countsAgree && distinct && oneHead && files.length < PULL_FILES_MAX, files };
}

/**
 * The head commit the first read judged, from `commits(last: 1)`.
 *
 * @param data the pull request's first read
 * @returns the last commit's oid, or `undefined` when the read carries none
 */
export function firstReadHead({ data }: { data: Readonly<Record<string, unknown>> }): string | undefined {
  const commits = data["commits"];
  const nodes = isRecord(commits) ? commits["nodes"] : undefined;
  const last: unknown = Array.isArray(nodes) ? nodes.at(-1) : undefined;
  const commit = isRecord(last) ? last["commit"] : undefined;
  const oid = isRecord(commit) ? commit["oid"] : undefined;
  return typeof oid === "string" ? oid : undefined;
}
