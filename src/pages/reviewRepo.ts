/**
 * The review repository a page's Codex pass reads — the effectful edge of `./review.ts`.
 *
 * `slopweaver page review-prepare` builds one per preparation under `$SLOPWEAVER_HOME/page-reviews/<slug>/<id>/`:
 * a git repository whose BASE commit holds the inputs the page answers to (the owner's words, the run's doc) and whose
 * HEAD commit adds the fragment as `page.html`. `codex review --repo <it> --base <base>` then judges the page as
 * a diff against what the owner asked, and the commits are what `page publish`
 * later reads back to prove a cited review was about this page.
 *
 * ## Why OUTSIDE `pages/`
 *
 * The console serves every file under a page's directory (`site/lib/localPageServe.ts`), so the inputs — the owner's
 * words, a run's doc — would become page assets. `orchestration/` is wrong too: its scanner reads every child
 * directory as a candidate pass (`../codex/ledgerStore.ts`). Each preparation is its own immutable directory, so
 * re-preparing a slug never rewrites a repository a pass already cited.
 *
 * Every git call goes through `../codex/gitRun.ts`'s `runGitChecked`: an argv array, a stripped `GIT_*`
 * environment and the canonical diff config, so the digest computed here is the one the review recorded.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { diffSha256, gitCommitDiffCommand } from "../codex/diff.js";
import { runGitChecked } from "../codex/gitRun.js";
import { errorMessage } from "../lib/errorMessage.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../lib/safeJson.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";
import type { PageReviewPreparation, PageReviewRecord, PreparedCommitFacts } from "./review.js";
import { type PageReviewError, PageReviewErrors } from "./reviewErrors.js";

/** The file inside a preparation directory that records what was committed. */
const PREPARATION_FILENAME = "preparation.json";

/** The repository directory inside a preparation directory — the root a review's record names. */
const REPO_DIRNAME = "repo";

/** The fragment's name inside the review repository. */
const PAGE_IN_REPO = "page.html";

/**
 * Config for the two commits a preparation makes: a fixed identity, no signing and no hooks, so a user's global
 * git setup can neither block the commit nor run code inside the home.
 */
const COMMIT_CONFIG: readonly string[] = [
  "-c",
  "user.name=slopweaver page review",
  "-c",
  "user.email=page-review@slopweaver.invalid",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.hooksPath=/dev/null",
];

/**
 * Committed first, so `git add` neither converts line endings nor runs a configured clean filter on the page or an
 * input: the bytes committed are the bytes read, which is what the digest binding depends on.
 */
const GITATTRIBUTES = "* -text -filter\n";

/** The orientation file at the base commit, telling the reviewer what the repository is. */
const README = [
  "# A page review",
  "",
  "`inputs/` holds what the page answers to: the owner's own words, the run's doc, any measurement it cites.",
  "The diff under review adds `page.html`, the page body exactly as publish will write it, every reference it resolves already linked.",
  "Publishing wraps it in the document shell and appends a fold of its own, after the body, naming each review",
  "that checked it, what that review attacked, its verdict and what changed after it. That fold is not yours to",
  "find missing: judge the body against the inputs. Stay inside this folder.",
  "",
].join("\n");

/** One input file to commit at the base, named for the reviewer. */
export interface PageReviewInput {
  /** The file's base name as the author passed it; numbered on commit so two of the same name cannot collide. */
  readonly name: string;
  readonly contents: string;
}

/**
 * sha256 of a string's UTF-8 bytes, lowercase hex — the one digest a fragment is bound by.
 *
 * @returns the digest
 */
export function fragmentSha256({ fragment }: { fragment: string }): string {
  return createHash("sha256").update(fragment, "utf8").digest("hex");
}

/**
 * The directory every preparation for one slug lives under.
 *
 * @returns `$home/page-reviews/<slug>`
 */
export function pageReviewSlugDirectory({ home, slug }: { home: string; slug: string }): string {
  return join(stateHomePaths({ home }).pageReviews, slug);
}

/**
 * The record a published page's review is kept in, outside the served page directory.
 *
 * @returns `$home/page-reviews/<slug>/published.json`
 */
function pageReviewRecordPath({ home, slug }: { home: string; slug: string }): string {
  return join(pageReviewSlugDirectory({ home, slug }), "published.json");
}

/** Run one git command in the review repository. */
function git({ repo, args }: { repo: string; args: readonly string[] }): string {
  return runGitChecked({ args, cwd: repo, label: `git ${args.find((arg) => !arg.startsWith("-"))!}` });
}

/** The base name an input is committed under: numbered, with anything path-like flattened. */
function inputFileName({ index, name }: { index: number; name: string }): string {
  const flattened = basename(name).replace(/[^A-Za-z0-9._-]/g, "-");
  return `${String(index + 1).padStart(2, "0")}-${flattened}`;
}

/** Write the base tree, commit it, add the page, commit that, and answer the two commits and the diff's size. */
function commitPreparation({
  repo,
  fragment,
  inputs,
}: {
  repo: string;
  fragment: string;
  inputs: readonly PageReviewInput[];
}): { readonly baseSha: string; readonly headSha: string; readonly diffBytes: number } {
  mkdirSync(join(repo, "inputs"), { recursive: true });
  writeFileSync(join(repo, ".gitattributes"), GITATTRIBUTES);
  writeFileSync(join(repo, "README.md"), README);
  inputs.forEach((input, index) => {
    writeFileSync(join(repo, "inputs", inputFileName({ index, name: input.name })), input.contents);
  });
  git({ args: ["init", "--quiet", "--initial-branch=main"], repo });
  git({ args: ["add", "--all"], repo });
  git({ args: [...COMMIT_CONFIG, "commit", "--quiet", "--no-verify", "-m", "inputs the page answers to"], repo });
  const baseSha = git({ args: ["rev-parse", "HEAD"], repo }).trim();
  writeFileSync(join(repo, PAGE_IN_REPO), fragment);
  git({ args: ["add", "--", PAGE_IN_REPO], repo });
  git({ args: [...COMMIT_CONFIG, "commit", "--quiet", "--no-verify", "-m", "the page under review"], repo });
  const headSha = git({ args: ["rev-parse", "HEAD"], repo }).trim();
  // The tree is clean at the head, so this commit diff is byte-identical to the worktree diff a review captures.
  const diff = git({ args: gitCommitDiffCommand({ commit: headSha, mergeBase: baseSha }).args, repo });
  return { baseSha, diffBytes: Buffer.byteLength(diff, "utf8"), headSha };
}

/**
 * Build one preparation: the repository, its two commits, and the record of what was committed.
 *
 * The directory is created exclusively and removed whole on any failure, so a half-built preparation never sits
 * where a later publish could resolve it.
 *
 * @param home the state home
 * @param slug the page the review is for
 * @param fragment the authored fragment, committed byte for byte as `page.html`
 * @param inputs what the page answers to, committed at the base
 * @param preparationId a fresh id naming this preparation's directory
 * @param createdAtIso when it was prepared
 * @returns the preparation, the repository root a review is pointed at, and the size of the diff it will read
 */
export function preparePageReview({
  home,
  slug,
  fragment,
  inputs,
  preparationId,
  createdAtIso,
}: {
  home: string;
  slug: string;
  fragment: string;
  inputs: readonly PageReviewInput[];
  preparationId: string;
  createdAtIso: string;
}): Result<
  { readonly preparation: PageReviewPreparation; readonly repoRoot: string; readonly diffBytes: number },
  PageReviewError
> {
  const directory = join(pageReviewSlugDirectory({ home, slug }), preparationId);
  if (existsSync(directory)) {
    return err(PageReviewErrors.preparationFailed({ detail: `${directory} already exists` }));
  }
  const repo = join(directory, REPO_DIRNAME);
  try {
    mkdirSync(repo, { recursive: true });
    const { baseSha, diffBytes, headSha } = commitPreparation({ fragment, inputs, repo });
    const preparation: PageReviewPreparation = {
      baseSha,
      createdAtIso,
      fragmentSha256: fragmentSha256({ fragment }),
      headSha,
      preparationId,
      schemaVersion: 1,
      slug,
    };
    writeFileAtomic({
      contents: `${safeJsonStringify({ label: "page review preparation", space: 2, value: preparation })}\n`,
      path: join(directory, PREPARATION_FILENAME),
    });
    return ok({ diffBytes, preparation, repoRoot: realpathSync(repo) });
  } catch (error: unknown) {
    rmSync(directory, { force: true, recursive: true });
    return err(PageReviewErrors.preparationFailed({ detail: errorMessage({ error }) }));
  }
}

/** Whether a parsed value is the preparation shape this module writes. */
function isPreparation(value: unknown): value is PageReviewPreparation {
  return (
    isRecord(value) &&
    value["schemaVersion"] === 1 &&
    typeof value["preparationId"] === "string" &&
    typeof value["slug"] === "string" &&
    typeof value["baseSha"] === "string" &&
    typeof value["headSha"] === "string" &&
    typeof value["fragmentSha256"] === "string" &&
    typeof value["createdAtIso"] === "string"
  );
}

/**
 * Resolve the preparation a review's recorded repository root names, when it is one of this slug's.
 *
 * @param home the state home
 * @param slug the page being published
 * @param repoRoot the repository root the review's record names
 * @returns the preparation; `undefined` when the root is not a preparation of this slug; an error when it is one
 *   whose record cannot be read or is not the shape this module wrote
 */
export function readPreparationAt({
  home,
  slug,
  repoRoot,
}: {
  home: string;
  slug: string;
  repoRoot: string;
}): Result<PageReviewPreparation | undefined, PageReviewError> {
  const slugDirectory = pageReviewSlugDirectory({ home, slug });
  if (!existsSync(slugDirectory) || !existsSync(repoRoot) || basename(repoRoot) !== REPO_DIRNAME) {
    return ok(undefined);
  }
  const preparationDirectory = dirname(realpathSync(repoRoot));
  if (dirname(preparationDirectory) !== realpathSync(slugDirectory)) {
    return ok(undefined);
  }
  const path = join(preparationDirectory, PREPARATION_FILENAME);
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: "page review preparation", text: readFileSync(path, "utf8") });
  } catch (error: unknown) {
    return err(PageReviewErrors.preparationFailed({ detail: `${path} cannot be read: ${errorMessage({ error })}` }));
  }
  if (!isPreparation(parsed) || parsed.preparationId !== basename(preparationDirectory)) {
    return err(
      PageReviewErrors.preparationFailed({ detail: `${path} is not the preparation record this verb writes` }),
    );
  }
  return ok(parsed);
}

/**
 * Read back, from a preparation's repository, the facts a cited review's commits must reproduce.
 *
 * @param repoRoot the preparation's repository
 * @param baseSha the review's recorded base commit
 * @param headSha the review's recorded head commit
 * @returns the commit-to-commit diff digest and the digest of `page.html` at the head, or why they could not be read
 */
export function preparedCommitFacts({
  repoRoot,
  baseSha,
  headSha,
}: {
  repoRoot: string;
  baseSha: string;
  headSha: string;
}): Result<PreparedCommitFacts, PageReviewError> {
  try {
    const diff = git({ args: gitCommitDiffCommand({ commit: headSha, mergeBase: baseSha }).args, repo: repoRoot });
    const page = git({ args: ["cat-file", "blob", `${headSha}:${PAGE_IN_REPO}`], repo: repoRoot });
    return ok({ diffSha256: diffSha256({ diff }), fragmentSha256: fragmentSha256({ fragment: page }) });
  } catch (error: unknown) {
    return err(PageReviewErrors.preparationFailed({ detail: `reading ${repoRoot}: ${errorMessage({ error })}` }));
  }
}

/**
 * Write the record a published page's review is kept in.
 *
 * @param home the state home
 * @param record the record the page published with
 * @returns the path written, or why it could not be
 */
export function writePageReviewRecord({
  home,
  record,
}: {
  home: string;
  record: PageReviewRecord;
}): Result<string, PageReviewError> {
  const path = pageReviewRecordPath({ home, slug: record.slug });
  try {
    writeFileAtomic({
      contents: `${safeJsonStringify({ label: "page review record", space: 2, value: record })}\n`,
      path,
    });
    return ok(path);
  } catch (error: unknown) {
    return err(PageReviewErrors.reviewRecordWriteFailed({ detail: errorMessage({ error }), path }));
  }
}
