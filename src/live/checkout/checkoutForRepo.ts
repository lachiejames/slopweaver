/**
 * WHICH local checkout a repository slug means — the one thing `cmux spawn` needs that a slug does not carry.
 *
 * A board row names a `repo:` PATH, because a worktree is cut from a checkout on this machine rather than
 * from a name on GitHub. `vulnerability-fix topup` knows `acme/acme-admin` and nothing else, so something has to
 * cross that gap.
 *
 * MEASURED, and the reason this module exists at all: the first real `vulnerability-fix topup` registered
 * its board row, then `cmux spawn` answered *"names no `repo:`, so there is nowhere to open a worktree in"*
 * and no session opened. The row was left on the board with nobody working it, which is the one outcome a
 * top-up that reports success must never produce.
 *
 * It sits here rather than under `../vuln/` because the failure is the SHAPE of every register-then-spawn
 * verb, not a fact about vulnerabilities — MEASURED again, on the first real `automation seat`,
 * which reproduced it word for word against a row it had already claimed. Resolve the
 * checkout BEFORE writing the row: a verb that registers first leaves a board row nobody is working, and
 * `seat` additionally had to release a claim it had already taken.
 *
 * The answer is DERIVED rather than configured twice: the declared main checkouts are already per-install
 * state (`admit/declaredMainCheckouts.ts`), and each one's own `origin` says which repository it is. So the
 * mapping is a read of what is already declared, and a slug nothing declares is a refusal naming the slug
 * rather than a guess at a path.
 */
import { declaredMainCheckoutPaths } from "../../admit/declaredMainCheckouts.js";
import { originRepositoryOf, type Repository } from "../../config.js";
import { codeCheckoutRoot, runningCheckoutRoot } from "../../lib/gitRepo.js";
import { err, ok, type Result } from "../../lib/result.js";

/** No declared main checkout has that repository as its `origin`. */
export interface CheckoutUndeclaredError {
  readonly code: "CHECKOUT_UNDECLARED";
  readonly message: string;
  /** The `owner/name` that matched nothing, so a refusal can be checked against what was asked for. */
  readonly slug: string;
}

/**
 * Build the refusal. Tests construct fixtures through this, never a hand-built literal.
 *
 * @internal
 */
export const CheckoutForRepoErrors = {
  undeclared: ({ slug, declared }: { slug: string; declared: readonly string[] }): CheckoutUndeclaredError => ({
    code: "CHECKOUT_UNDECLARED",
    message:
      `no declared main checkout has ${slug} as its \`origin\`, so there is nowhere on this machine to open ` +
      `a worktree for it. Declared: ${declared.length === 0 ? "none" : declared.join(", ")}`,
    slug,
  }),
} as const;

/**
 * The local checkout whose `origin` is this repository.
 *
 * @param owner the repository owner
 * @param repo the repository name
 * @param home the state home whose profile declares the main checkouts
 * @param paths every declared checkout path, injectable so a unit test needs no profile
 * @param originOf one checkout's own `origin` slug, injectable so a unit test needs no git
 * @returns the checkout path, or why no declared one is that repository
 */
export function checkoutForRepo({
  owner,
  repo,
  home,
  paths = (args) => declaredMainCheckoutPaths(args),
  originOf = (args) => originSlugOf(args),
}: {
  owner: string;
  repo: string;
  home: string;
  paths?: (args: { home: string }) => readonly string[];
  originOf?: (args: { cwd: string }) => string | undefined;
}): Result<string, CheckoutUndeclaredError> {
  const slug = `${owner}/${repo}`;
  const declared = paths({ home });
  const found = declared.find((cwd) => originOf({ cwd })?.toLowerCase() === slug.toLowerCase());
  if (found === undefined) {
    return err(CheckoutForRepoErrors.undeclared({ declared, slug }));
  }
  return ok(found);
}

/** No declared main checkout's `origin` carries that repository name. */
export interface CheckoutNameUndeclaredError {
  readonly code: "CHECKOUT_NAME_UNDECLARED";
  readonly message: string;
  /** The bare name that matched nothing. */
  readonly name: string;
}

/** Two or more declared main checkouts carry that repository name under different owners. */
export interface CheckoutNameAmbiguousError {
  readonly code: "CHECKOUT_NAME_AMBIGUOUS";
  readonly message: string;
  /** The bare name that matched more than one. */
  readonly name: string;
}

/** Why a bare repository name resolves to no single declared checkout. */
export type CheckoutNameError = CheckoutNameUndeclaredError | CheckoutNameAmbiguousError;

/**
 * Build the name refusals. Tests construct fixtures through this, never a hand-built literal.
 *
 * @internal
 */
export const CheckoutNameErrors = {
  ambiguous: ({ name, matches }: { name: string; matches: readonly string[] }): CheckoutNameAmbiguousError => ({
    code: "CHECKOUT_NAME_AMBIGUOUS",
    message:
      `${String(matches.length)} declared main checkouts are named ${name} (${matches.join(", ")}), so the name ` +
      "picks none of them — pass the owner/name or the checkout's path",
    name,
  }),
  undeclared: ({ name, declared }: { name: string; declared: readonly string[] }): CheckoutNameUndeclaredError => ({
    code: "CHECKOUT_NAME_UNDECLARED",
    message:
      `no declared main checkout has a repository named ${name} as its \`origin\`, and a bare name is never read ` +
      `as a directory — pass an absolute path, or ./${name} for one relative to here. Declared: ` +
      `${declared.length === 0 ? "none" : declared.join(", ")}`,
    name,
  }),
} as const;

/**
 * The ONE declared main checkout whose `origin` repository is called `name`, whatever its owner.
 *
 * MEASURED, the reason it exists: `handover register --repo slopweaver` wrote the bare
 * name into the row verbatim, and a seat then ran git with `slopweaver` as its working directory and died.
 * A name is what a person types; the declared checkouts already say which path it means, so the answer is a
 * read of that declaration — and a name two owners share is a refusal, never a pick.
 *
 * @param name the repository name, without an owner, matched case-insensitively
 * @param home the state home whose profile declares the main checkouts
 * @param paths every declared checkout path, injectable so a unit test needs no profile
 * @param originOf one checkout's own `origin` slug, injectable so a unit test needs no git
 * @returns the checkout path, or why no single declared one carries that name
 */
export function checkoutForRepoName({
  name,
  home,
  paths = (args) => declaredMainCheckoutPaths(args),
  originOf = (args) => originSlugOf(args),
}: {
  name: string;
  home: string;
  paths?: (args: { home: string }) => readonly string[];
  originOf?: (args: { cwd: string }) => string | undefined;
}): Result<string, CheckoutNameError> {
  const declared = paths({ home });
  const wanted = name.toLowerCase();
  const matches = declared.filter((cwd) => originOf({ cwd })?.split("/")[1]?.toLowerCase() === wanted);
  if (matches.length === 0) {
    return err(CheckoutNameErrors.undeclared({ declared, name }));
  }
  if (matches.length > 1) {
    return err(CheckoutNameErrors.ambiguous({ matches, name }));
  }
  return ok(matches[0]!);
}

/**
 * The declared main checkout a register-then-spawn verb should open its seat against: the one whose
 * `origin` is the repository THIS process is running from.
 *
 * Derived rather than configured, so there is no second place to keep it current — and it is the answer to
 * the question every caller of this module arrives with, which is why it lives beside {@link checkoutForRepo}
 * rather than in any one verb. `machine watch` was the THIRD verb to need it and the second to ship without
 * it; the header above carries the first two measurements.
 *
 * A worktree is cut from a main checkout, never from another worktree, which is why this resolves the
 * DECLARATION rather than answering `runningCheckoutRoot()` directly. A caller standing in a worktree still
 * lands on the right checkout, because a worktree shares its repository's `origin`.
 *
 * A process standing OUTSIDE every checkout is still running this repository's code, so when the directory it
 * stands in has no readable `origin`, the checkout its code was loaded from is asked next
 * (`codeCheckoutRoot`, `../../lib/gitRepo.ts`, which carries the measured failure: a scheduled `automation run-due`
 * launched in the state home filed its failure finding naming no repo). Only when neither answers is it a
 * refusal, naming both.
 *
 * @param home the state home whose profile declares the main checkouts
 * @param verb the calling verb, so the refusal reads as that verb's own sentence
 * @param root the checkout the process is standing in, injectable so a unit test needs no git
 * @param codeRoot the checkout this process's code was loaded from, read only when `root` has no readable
 *   `origin`, and `undefined` when the code sits in no repository (a plugin mirror)
 * @param repositoryOf the running checkout's own `origin`, injectable for the same reason
 * @param paths every declared checkout path, injectable so a unit test needs no profile
 * @param originOf one checkout's own `origin` slug, injectable so a unit test needs no git
 * @returns the checkout path, or why no declared one is this repository
 */
export function checkoutForRunningRepo({
  home,
  verb,
  root = runningCheckoutRoot(),
  codeRoot = () => codeCheckoutRoot(),
  repositoryOf = (args) => originRepositoryOf(args),
  paths = (args) => declaredMainCheckoutPaths(args),
  originOf = (args) => originSlugOf(args),
}: {
  home: string;
  verb: string;
  root?: string;
  codeRoot?: () => string | undefined;
  repositoryOf?: (args: { cwd: string }) => Result<Repository>;
  paths?: (args: { home: string }) => readonly string[];
  originOf?: (args: { cwd: string }) => string | undefined;
}): Result<string> {
  const repository = runningRepository({ codeRoot, repositoryOf, root });
  if (repository.isErr()) {
    return err([`${verb}: ${repository.error}, so there is no repository to open a seated session against`]);
  }
  return checkoutForRepo({
    home,
    originOf,
    owner: repository.value.owner,
    paths,
    repo: repository.value.repo,
  }).mapErr((error) => [error.message] as const);
}

/**
 * The repository this process runs: the standing checkout's `origin`, else its code's own checkout's.
 *
 * @returns the repository, or the clause naming every anchor that had no readable `origin`
 */
function runningRepository({
  codeRoot,
  repositoryOf,
  root,
}: {
  codeRoot: () => string | undefined;
  repositoryOf: (args: { cwd: string }) => Result<Repository>;
  root: string;
}): Result<Repository, string> {
  const standing = repositoryOf({ cwd: root });
  if (standing.isOk()) {
    return ok(standing.value);
  }
  const code = codeRoot();
  if (code === undefined) {
    return err(`${root} has no readable \`origin\`, and this build's own code sits in no checkout`);
  }
  const loaded = repositoryOf({ cwd: code });
  if (loaded.isOk()) {
    return ok(loaded.value);
  }
  return err(`neither ${root} nor this build's own checkout ${code} has a readable \`origin\``);
}

/**
 * One checkout's `origin` as `owner/name`, read by git. The production `originOf` every resolver here defaults to,
 * exported so a caller threading that seam through several layers names the same reader rather than a copy.
 *
 * @param cwd the checkout whose `origin` remote is read
 * @returns the `owner/name` slug, or `undefined` when it has none this build can read
 */
export function originSlugOf({ cwd }: { cwd: string }): string | undefined {
  const repository = originRepositoryOf({ cwd });
  if (repository.isErr()) {
    return undefined;
  }
  return `${repository.value.owner}/${repository.value.repo}`;
}
