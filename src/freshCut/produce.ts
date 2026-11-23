/**
 * `fresh-cut produce`'s work: from one commit on the source repository's local `main`, write ONE parentless commit
 * over exactly that commit's tree into a new local repository, signed as the owner's GitHub no-reply identity, and
 * record the source SHA, the tree hash and the new root SHA in the state home.
 *
 * ## Only the commit's tree, never the checkout
 *
 * The new commit is built with `commit-tree` over the source commit's TREE OBJECT, read through the source's object
 * store as a temporary alternate, and `repack -a` then copies exactly the objects that one commit reaches. No file is
 * read from a working tree, so untracked, ignored and edited files cannot enter the cut, and no line-ending filter
 * can change a byte. The source repository is only read: the alternate is an environment variable on the new
 * repository's commands, never a file in either repository.
 *
 * ## Nothing leaves the machine
 *
 * The new repository gets no remote, and nothing here pushes. The one network call is the GitHub viewer read the
 * shell makes before calling in, which supplies the identity.
 */
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { err, ok, type Result } from "../lib/result.js";
import {
  FRESH_CUT_MESSAGE,
  type FreshCutRecord,
  firstGitlinkPath,
  isHexObjectId,
  parseCommitDate,
  parseTreeListing,
  type TreeEntry,
} from "./core.js";
import { type FreshCutError, FreshCutErrors } from "./errors.js";
import { freshCutGitText, type GitRunFailure, runFreshCutGit } from "./git.js";

/**
 * Paths under a cut's `.git` that must not exist: state outside the one ref and the objects, which `for-each-ref`
 * and `fsck` never report. A reflog records this machine's fallback identity; a pseudoref, hook or alternates file
 * is history, code or a borrowed store the cut was never meant to carry.
 */
const STRAY_GIT_PATHS: readonly string[] = [
  "ORIG_HEAD",
  "FETCH_HEAD",
  "MERGE_HEAD",
  "logs",
  "hooks",
  "objects/info/alternates",
];

/** The identity a cut is signed with: the login and the address derived from the live GitHub read. */
export interface FreshCutIdentity {
  readonly login: string;
  readonly address: string;
}

/**
 * Read one value from the source repository, mapping a failure to `SOURCE_UNREADABLE`.
 *
 * @param source the source checkout
 * @param args the git argv
 * @returns trimmed stdout, or the typed failure
 */
function sourceText({ source, args }: { source: string; args: readonly string[] }): Result<string, FreshCutError> {
  return freshCutGitText({ args, cwd: source }).mapErr((failure) =>
    FreshCutErrors.sourceUnreadable({ cause: failure.cause, step: args[0]! }),
  );
}

/**
 * Run one git write in the new repository, mapping a failure to `CUT_WRITE_FAILED`.
 *
 * @param destination the new repository
 * @param args the git argv
 * @param extraEnv the variables this write states
 * @returns trimmed stdout, or the typed failure
 */
function cutText({
  destination,
  args,
  extraEnv = {},
}: {
  destination: string;
  args: readonly string[];
  extraEnv?: Readonly<Record<string, string>>;
}): Result<string, FreshCutError> {
  return freshCutGitText({ args, cwd: destination, extraEnv }).mapErr((failure) =>
    FreshCutErrors.cutWriteFailed({ cause: failure.cause, step: args[0]! }),
  );
}

/** What the source repository says about the named commit. */
interface SourceFacts {
  readonly source: string;
  readonly sourceSha: string;
  readonly treeSha: string;
  readonly committerDate: string;
  readonly objectsDirectory: string;
  readonly objectFormat: string;
}

/**
 * Resolve the named commit in the source repository and read everything a cut needs about it, refusing a ref name,
 * a commit not on local `main`, and a tree holding a submodule.
 *
 * @param source the source checkout, absolute
 * @param commit the hexadecimal commit id the caller named
 * @returns the facts, or the first refusal
 */
function readSourceFacts({ source, commit }: { source: string; commit: string }): Result<SourceFacts, FreshCutError> {
  if (!isHexObjectId({ given: commit })) {
    return err(FreshCutErrors.commitInvalid({ given: commit }));
  }
  const resolved = freshCutGitText({
    args: ["rev-parse", "--verify", "--quiet", "--end-of-options", `${commit}^{commit}`],
    cwd: source,
  });
  if (resolved.isErr()) {
    return err(FreshCutErrors.commitInvalid({ given: commit }));
  }
  const sourceSha = resolved.value;
  const onMain = freshCutGitText({ args: ["merge-base", "--is-ancestor", sourceSha, "refs/heads/main"], cwd: source });
  if (onMain.isErr()) {
    return err(notOnMainOrUnreadable({ failure: onMain.error, sha: sourceSha }));
  }
  const treeSha = sourceText({ args: ["rev-parse", "--verify", `${sourceSha}^{tree}`], source });
  if (treeSha.isErr()) {
    return err(treeSha.error);
  }
  const committerDate = sourceText({ args: ["show", "-s", "--date=raw", "--format=%cd", sourceSha], source }).andThen(
    (text) => parseCommitDate({ text }).mapErr((cause) => FreshCutErrors.sourceUnreadable({ cause, step: "show" })),
  );
  if (committerDate.isErr()) {
    return err(committerDate.error);
  }
  const commonDir = sourceText({ args: ["rev-parse", "--path-format=absolute", "--git-common-dir"], source });
  if (commonDir.isErr()) {
    return err(commonDir.error);
  }
  const objectFormat = sourceText({ args: ["rev-parse", "--show-object-format"], source });
  if (objectFormat.isErr()) {
    return err(objectFormat.error);
  }
  const entries = readTreeEntries({ cwd: source, treeSha: treeSha.value });
  if (entries.isErr()) {
    return err(FreshCutErrors.sourceUnreadable({ cause: entries.error, step: "ls-tree" }));
  }
  const gitlink = firstGitlinkPath({ entries: entries.value });
  if (gitlink !== undefined) {
    return err(FreshCutErrors.gitlinkInTree({ path: gitlink }));
  }
  return ok({
    committerDate: committerDate.value,
    objectFormat: objectFormat.value,
    objectsDirectory: join(commonDir.value, "objects"),
    source,
    sourceSha,
    treeSha: treeSha.value,
  });
}

/**
 * Pure: `merge-base --is-ancestor` exits 1 for "not an ancestor" and anything else for a failed read.
 *
 * @param failure the failed run
 * @param sha the commit asked about
 * @returns the typed failure
 */
function notOnMainOrUnreadable({ failure, sha }: { failure: GitRunFailure; sha: string }): FreshCutError {
  if (failure.status === 1) {
    return FreshCutErrors.commitNotOnMain({ sha });
  }
  return FreshCutErrors.sourceUnreadable({ cause: failure.cause, step: "merge-base" });
}

/**
 * Every entry of a tree, recursively, read from the object store.
 *
 * @param cwd the repository whose objects hold the tree
 * @param treeSha the root tree object to list recursively
 * @param extraEnv the variables the read states
 * @returns the entries, or why they could not be read
 */
export function readTreeEntries({
  cwd,
  treeSha,
  extraEnv = {},
}: {
  cwd: string;
  treeSha: string;
  extraEnv?: Readonly<Record<string, string>>;
}): Result<readonly TreeEntry[], string> {
  return runFreshCutGit({ args: ["ls-tree", "-r", "-z", "--full-tree", treeSha], cwd, extraEnv })
    .mapErr((failure) => failure.cause)
    .andThen((output) => parseTreeListing({ output }));
}

/**
 * Refuse a destination that is relative, already holds something, or sits inside any git checkout — the source's,
 * one of its worktrees, or any other — judged at the nearest directory that exists, so a path that does not exist
 * yet cannot hide inside one.
 *
 * @param destination the directory the caller named
 * @returns the absolute destination, or the refusal
 */
function checkDestination({ destination }: { destination: string }): Result<string, FreshCutError> {
  if (!isAbsolute(destination)) {
    return err(FreshCutErrors.destinationRefused({ destination, why: "pass an absolute path" }));
  }
  const absolute = resolve(destination);
  if (existsSync(absolute)) {
    if (!statSync(absolute).isDirectory() || readdirSync(absolute).length > 0) {
      return err(
        FreshCutErrors.destinationRefused({ destination: absolute, why: "it exists and is not an empty directory" }),
      );
    }
  }
  let nearest = absolute;
  while (!existsSync(nearest)) {
    nearest = dirname(nearest);
  }
  const enclosing = freshCutGitText({ args: ["rev-parse", "--absolute-git-dir"], cwd: nearest });
  if (enclosing.isOk()) {
    return err(
      FreshCutErrors.destinationRefused({
        destination: absolute,
        why: `it is inside the git repository whose git directory is ${enclosing.value}; cut outside every checkout`,
      }),
    );
  }
  return ok(absolute);
}

/**
 * Write the cut: initialise the new repository, commit the source tree as its only commit, copy that commit's
 * objects in, check the result out, and check every property the record will claim.
 *
 * @param facts what the source said about the commit
 * @param destination the checked, absolute destination
 * @param identity who the commit is signed as
 * @returns the new root SHA, or the first failure
 */
function writeCut({
  facts,
  destination,
  identity,
}: {
  facts: SourceFacts;
  destination: string;
  identity: FreshCutIdentity;
}): Result<string, FreshCutError> {
  try {
    mkdirSync(destination, { recursive: true });
  } catch (error) {
    return err(
      FreshCutErrors.cutWriteFailed({ cause: error instanceof Error ? error.message : String(error), step: "mkdir" }),
    );
  }
  const borrow = { GIT_ALTERNATE_OBJECT_DIRECTORIES: facts.objectsDirectory };
  const signed = {
    ...borrow,
    GIT_AUTHOR_DATE: facts.committerDate,
    GIT_AUTHOR_EMAIL: identity.address,
    GIT_AUTHOR_NAME: identity.login,
    GIT_COMMITTER_DATE: facts.committerDate,
    GIT_COMMITTER_EMAIL: identity.address,
    GIT_COMMITTER_NAME: identity.login,
  };
  return cutText({
    args: ["init", "--quiet", "--initial-branch=main", `--object-format=${facts.objectFormat}`, "--template="],
    destination,
  })
    .andThen(() =>
      cutText({ args: ["commit-tree", facts.treeSha, "-m", FRESH_CUT_MESSAGE], destination, extraEnv: signed }),
    )
    .andThen((rootSha) =>
      cutText({ args: ["update-ref", "refs/heads/main", rootSha, ""], destination })
        .andThen(() => cutText({ args: ["repack", "-a", "-d", "-q"], destination, extraEnv: borrow }))
        // `read-tree -u`, not `reset --hard`: a reset leaves an ORIG_HEAD pseudoref behind in the cut.
        .andThen(() => cutText({ args: ["read-tree", "--reset", "-u", "HEAD"], destination }))
        .andThen(() => checkCut({ destination, rootSha, treeSha: facts.treeSha }))
        .map(() => rootSha),
    );
}

/**
 * Check, with NO alternate object store, that the new repository is exactly one parentless commit on `main` over
 * the expected tree, with no remote and every object present. Run after produce and again by verify.
 *
 * @param destination the new repository
 * @param rootSha the commit it should hold
 * @param treeSha the tree that commit should carry
 * @returns nothing, or the first property that does not hold
 */
export function checkCut({
  destination,
  rootSha,
  treeSha,
}: {
  destination: string;
  rootSha: string;
  treeSha: string;
}): Result<void, FreshCutError> {
  const expectations: readonly { args: readonly string[]; want: string; what: string }[] = [
    { args: ["rev-parse", "--verify", "HEAD"], want: rootSha, what: "HEAD" },
    { args: ["symbolic-ref", "HEAD"], want: "refs/heads/main", what: "the checked-out branch" },
    { args: ["rev-parse", "--verify", `${rootSha}^{tree}`], want: treeSha, what: "the root's tree" },
    { args: ["rev-list", "--parents", "-n", "1", rootSha], want: rootSha, what: "the root's parent line" },
    { args: ["rev-list", "--all", "--count"], want: "1", what: "the number of reachable commits" },
    { args: ["for-each-ref", "--format=%(refname)"], want: "refs/heads/main", what: "the refs" },
    { args: ["remote"], want: "", what: "the remotes" },
    // With no alternate in the environment, a missing object fails here: the cut holds its own objects.
    { args: ["fsck", "--full", "--no-dangling", "--no-progress"], want: "", what: "fsck's report" },
  ];
  // A pseudoref, a reflog, a hook or an alternates file is state `for-each-ref` never lists.
  const strays = STRAY_GIT_PATHS.filter((path) => existsSync(join(destination, ".git", path)));
  if (strays.length > 0) {
    return err(FreshCutErrors.cutMismatch({ why: `the git directory holds ${strays.join(", ")}` }));
  }
  for (const { args, want, what } of expectations) {
    const got = freshCutGitText({ args, cwd: destination });
    if (got.isErr()) {
      return err(FreshCutErrors.cutMismatch({ why: `git ${args[0]!} failed: ${got.error.cause}` }));
    }
    if (got.value !== want) {
      return err(
        FreshCutErrors.cutMismatch({ why: `${what} is ${JSON.stringify(got.value)}, not ${JSON.stringify(want)}` }),
      );
    }
  }
  return ok(undefined);
}

/**
 * Produce one fresh cut and return its record, unwritten: the shell writes it once this succeeds.
 *
 * @param source the source checkout, absolute
 * @param commit the hexadecimal commit id on `main`
 * @param destination the new repository's directory, absolute, outside every checkout
 * @param identity who the commit is signed as, read live by the caller
 * @param recordId the new record's id
 * @param now the instant the record is stamped with
 * @returns the record, or the first refusal or failure
 */
export function produceFreshCut({
  source,
  commit,
  destination,
  identity,
  recordId,
  now,
}: {
  source: string;
  commit: string;
  destination: string;
  identity: FreshCutIdentity;
  recordId: string;
  now: Date;
}): Result<FreshCutRecord, FreshCutError> {
  const topLevel = sourceText({ args: ["rev-parse", "--show-toplevel"], source: resolve(source) });
  if (topLevel.isErr()) {
    return err(topLevel.error);
  }
  const absoluteSource = topLevel.value;
  return readSourceFacts({ commit, source: absoluteSource }).andThen((facts) =>
    checkDestination({ destination }).andThen((checked) =>
      writeCut({ destination: checked, facts, identity }).map((rootSha): FreshCutRecord => ({
        destination: checked,
        login: identity.login,
        producedAtIso: now.toISOString(),
        recordId,
        rootSha,
        schemaVersion: 1,
        source: absoluteSource,
        sourceCommitterDate: facts.committerDate,
        sourceSha: facts.sourceSha,
        treeSha: facts.treeSha,
      })),
    ),
  );
}
