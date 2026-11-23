/**
 * `github read --files`: the ordinary pull-request read, plus the files it changes and each one's patch — the diff a
 * reviewer reads on GitHub's "Files changed" tab.
 *
 * GraphQL carries a pull request's changed paths but never a patch, so this is the REST list
 * (`GET /repos/{owner}/{repo}/pulls/{pull_number}/files`) through the same Octokit client and provider door as the
 * GraphQL read (`./read.ts` `githubReadRest`). Each item is carried RAW at `data.files.nodes`, exactly as GitHub
 * wrote it — `filename`, `status`, `additions`, `deletions`, `patch`, `previous_filename` on a rename — and GitHub
 * itself omits `patch` for a binary file and for one too large to diff, which a reader must say rather than draw an
 * empty diff.
 *
 * Every page is read, {@link PULL_FILES_PER_PAGE} at a time, so a file-list claim about a large pull request is
 * checkable inside the door rather than by dropping to local git. GitHub's list itself stops at
 * {@link PULL_FILES_MAX}; a pull request changing more than that is named in the residue with how many files the
 * list could not carry, never silently cut. `data.files` is shaped like a GraphQL connection whose `totalCount` is
 * the pull request's own `changedFiles`, so a reader comparing the two sees any cut without the residue.
 *
 * The object and the list are two reads, as they were when this read one page. A push between them that moves the
 * head or the count is named in the residue; a base push that moves neither replaces the list unseen, since no REST
 * entry names the base it was diffed against. The list is then GitHub's whole answer at its own read,
 * and only the object beside it is older.
 */

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { ProviderReadDocument } from "../providerRead.js";
import { diffedAtOf, firstReadHead, PULL_FILES_MAX } from "./diffOnBaseListed.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import { type GithubReadRest, parseGithubReadAddress } from "./read.js";

export { PULL_FILES_MAX } from "./diffOnBaseListed.js";

/** GitHub's own maximum page size for this list. */
export const PULL_FILES_PER_PAGE = 100;

/** The REST route, written once so a test's fake can match on it. */
export const PULL_FILES_ROUTE = "GET /repos/{owner}/{repo}/pulls/{pull_number}/files";

/** The pages it takes to reach {@link PULL_FILES_MAX}; past the last of them GitHub answers an empty list. */
export const PULL_FILES_MAX_PAGES = PULL_FILES_MAX / PULL_FILES_PER_PAGE;

/**
 * Add a pull request's changed files, with their patches, to a document `readGithubObject` already produced.
 *
 * @param document the pull request's ordinary read — its `target` names the repository and number
 * @param rest the safe-wrapped REST seam
 * @returns the document with every readable page at `data.files` and any cut named in its residue, or a named failure
 */
export async function withPullFiles({
  document,
  rest,
}: {
  document: ProviderReadDocument;
  rest: GithubReadRest;
}): Promise<Result<ProviderReadDocument, GithubLiveError>> {
  const parsed = parseGithubReadAddress({ address: document.target.address });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const target = parsed.value;
  if (target.kind !== "pull-request") {
    return err(
      GithubLiveErrors.invalidAddress({
        message: `--files reads a pull request, and ${target.identity} is a ${target.kind}`,
      }),
    );
  }
  if (!isRecord(document.data)) {
    return err(
      GithubLiveErrors.readFailed({
        message: `the read of ${target.identity} carried no pull request to add files to`,
      }),
    );
  }
  const changed = document.data["changedFiles"];
  const counted = typeof changed === "number" ? changed : undefined;
  const read = await readEveryPage({ identity: target.identity, pull: target, rest });
  if (read.isErr()) {
    return err(read.error);
  }
  const { nodes, pages } = read.value;
  let totalCount = nodes.length;
  if (counted !== undefined) {
    totalCount = counted;
  }
  const files = { nodes, pageInfo: { endCursor: null, hasNextPage: false }, totalCount };
  const cut = fileListCut({ counted, held: nodes.length });
  const moved = fileListHeads({ firstHead: firstReadHead({ data: document.data }), nodes });
  const repeated = fileListRepeats({ nodes });
  const unsnapshotted = pagedListLimit({ pages });
  return ok({
    ...document,
    coverage: {
      ...document.coverage,
      residue: [...document.coverage.residue, ...cut, ...moved, ...repeated, ...unsnapshotted],
    },
    data: { ...document.data, files },
  });
}

/**
 * The residue line stating what a list read over several pages cannot prove, or none for a one-page read.
 *
 * GitHub serves this list as offset pages with no snapshot between them, so a base pushed away and back between two
 * of them can shift entries across a page boundary while the head, every entry's ref and the total all still agree
 *. No later read can rule that out, so it is stated on every read it could affect rather than
 * discovered; a one-page read is one response and cannot be spliced.
 *
 * @returns one line when more than one page was read, otherwise none
 */
function pagedListLimit({ pages }: { pages: number }): readonly string[] {
  if (pages <= 1) {
    return [];
  }
  return [
    `data.files was read in ${String(pages)} pages, which GitHub does not serve as one snapshot: a push to the base ` +
      "between them could shift files across a page unseen",
  ];
}

/**
 * The residue line naming a list that carries one file twice, or none when every filename is distinct.
 *
 * A base push between two offset pages can shift the list across their boundary while the head and the count stay
 * put. Every file a shift skips then has a repeat standing in its place, so a repeat is the one trace
 * such a splice leaves.
 *
 * @returns no line when no filename repeats; otherwise one line saying how many repeat
 */
function fileListRepeats({ nodes }: { nodes: readonly unknown[] }): readonly string[] {
  const seen = new Set<string>();
  let repeats = 0;
  for (const node of nodes) {
    const filename = isRecord(node) ? node["filename"] : undefined;
    if (typeof filename === "string") {
      if (seen.has(filename)) {
        repeats += 1;
      }
      seen.add(filename);
    }
  }
  if (repeats === 0) {
    return [];
  }
  return [
    `data.files lists ${String(repeats)} file(s) twice: a push shifted its pages between reads, so as many files ` +
      "may be missing — re-read before relying on the list",
  ];
}

/**
 * The residue line naming a list read across a push, or none when every entry was diffed at the one head the pull
 * request was read at.
 *
 * The pages are offset pages read one after another, so a push between two of them splices two heads' lists into
 * one whose length can still match the count. Each entry's `contents_url` names the head GitHub
 * diffed it at, which is what makes the splice visible; an entry naming none is not counted either way.
 *
 * @returns no line when the list is one head's, the first read's; otherwise one line naming the push
 */
function fileListHeads({
  firstHead,
  nodes,
}: {
  firstHead: string | undefined;
  nodes: readonly unknown[];
}): readonly string[] {
  const heads = new Set<string>();
  for (const node of nodes) {
    const head = isRecord(node) ? diffedAtOf({ contentsUrl: node["contents_url"] }) : undefined;
    if (head !== undefined) {
      heads.add(head);
    }
  }
  if (heads.size > 1) {
    return [
      `data.files was read across ${String(heads.size)} heads: a push landed between its pages, so the list mixes ` +
        "them — re-read before relying on it",
    ];
  }
  const [head] = heads;
  if (head === undefined || firstHead === undefined || head === firstHead) {
    return [];
  }
  return [
    `data.files was read at head ${head.slice(0, 10)} but the pull request at ${firstHead.slice(0, 10)}: a push ` +
      "landed between the two reads, so re-read before relying on the list",
  ];
}

/**
 * Read the file list page by page until a short page or GitHub's cap ends it.
 *
 * Only a short page ends the list, never the pull request's own count: that count came from an earlier read, and a
 * push between the two can grow the list past it, so stopping on a full page that matched it would present a short
 * list as whole. A count on a page boundary costs one empty page instead. A failed or malformed page
 * fails the whole read: a partial list presented as the list is the confident wrong verdict this read exists to
 * prevent.
 */
async function readEveryPage({
  identity,
  pull,
  rest,
}: {
  identity: string;
  pull: { readonly owner: string; readonly repo: string; readonly number: number };
  rest: GithubReadRest;
}): Promise<Result<{ readonly nodes: readonly unknown[]; readonly pages: number }, GithubLiveError>> {
  const nodes: unknown[] = [];
  let pages = 0;
  for (let index = 1; index <= PULL_FILES_MAX_PAGES; index += 1) {
    pages = index;
    const answered = await rest({
      params: {
        owner: pull.owner,
        page: index,
        per_page: PULL_FILES_PER_PAGE,
        pull_number: pull.number,
        repo: pull.repo,
      },
      route: PULL_FILES_ROUTE,
    });
    if (answered.isErr()) {
      return err(answered.error);
    }
    const body = isRecord(answered.value) ? answered.value["data"] : undefined;
    if (!Array.isArray(body)) {
      return err(
        GithubLiveErrors.readFailed({ message: `GitHub answered the file list of ${identity} without a list` }),
      );
    }
    const entries: readonly unknown[] = body;
    nodes.push(...entries);
    if (entries.length < PULL_FILES_PER_PAGE) {
      return ok({ nodes, pages });
    }
  }
  return ok({ nodes, pages });
}

/**
 * The residue line naming how the file list falls short of the pull request, or none when it is whole.
 *
 * @returns no line when the list holds every counted file; otherwise one line saying how many it holds, how many it
 *   could not, and why
 */
function fileListCut({ counted, held }: { counted: number | undefined; held: number }): readonly string[] {
  const atCap = held >= PULL_FILES_MAX;
  if (counted === undefined) {
    if (!atCap) {
      return [];
    }
    return [
      `data.files holds ${String(held)} files, GitHub's cap on this list, and the read carried no changedFiles ` +
        "count to say whether the pull request changes more",
    ];
  }
  if (counted === held) {
    if (!atCap) {
      return [];
    }
    // GitHub answers 3000 for a list it cut, so a count of exactly 3000 cannot tell whole from grown.
    return [
      `data.files holds ${String(held)} files, GitHub's cap on this list, as the pull request counts: whole unless a ` +
        "push between the two reads added more, which a capped list cannot show",
    ];
  }
  if (counted < held) {
    return [
      `data.files holds ${String(held)} files but the pull request counts ${String(counted)} changed: the two reads ` +
        "disagree, most likely a push between them, so re-read before relying on the list",
    ];
  }
  const missing = String(counted - held);
  if (atCap) {
    return [
      `data.files holds ${String(held)} of ${String(counted)} changed files: GitHub's pull-request file list stops at ` +
        `${String(PULL_FILES_MAX)}, so the other ${missing} cannot be read through it — read the diff from git instead`,
    ];
  }
  return [
    `data.files holds ${String(held)} of ${String(counted)} changed files: GitHub ended the list ${missing} short of ` +
      "its own count, most likely a push between the two reads, so re-read before relying on the list",
  ];
}
