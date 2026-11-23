/**
 * Which checkout a row's `repo:` may name — the one judge `handover register` and `handover set-repo` share.
 *
 * `cmux spawn` cuts a seat's worktree from a row's `repo:` by running git IN it, so whatever lands in that
 * field is a working directory, not a label. MEASURED: `handover register --repo
 * slopweaver` wrote the bare name verbatim, and the row's seat died twice on `git worktree list --porcelain
 * failed` with no detail at all — the listing ran in 0.27s from the real checkout, and the row seated once its
 * `repo:` was the absolute path. `set-repo` already judged its value; `register` wrote whatever it was given.
 * One judge for both verbs is the fix, so a value one of them refuses cannot reach the board through the other.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { isMainWorktree } from "../admit/mainWorktree.js";
import { repoRootFromDirectory } from "../lib/gitRepo.js";
import { err, ok, type Result } from "../lib/result.js";
import { sameDirectory } from "../lib/sameDirectory.js";
import { checkoutForRepo, checkoutForRepoName } from "../live/checkout/checkoutForRepo.js";

/**
 * What `--repo`'s path turned out to be on disk — the one effectful read {@link checkoutFor} judges.
 *
 * A union rather than a boolean because each refusal names a different fix: a typo, a subdirectory of the
 * right checkout, or a seat's worktree where its main checkout was meant.
 */
export type CheckoutProbe =
  | { readonly kind: "not-a-checkout" }
  | { readonly kind: "nested"; readonly top: string }
  | { readonly kind: "linked-worktree"; readonly top: string }
  | { readonly kind: "main"; readonly top: string };

/** Why `--repo` names no main checkout — one variant per fix the caller has to make. */
export type RepoCheckoutError =
  | { readonly code: "REPO_EMPTY"; readonly message: string }
  | { readonly code: "REPO_LINE_BREAK"; readonly message: string }
  | { readonly code: "REPO_NESTED"; readonly message: string; readonly top: string }
  | { readonly code: "REPO_LINKED_WORKTREE"; readonly message: string; readonly top: string }
  | { readonly code: "REPO_NOT_A_CHECKOUT"; readonly message: string }
  | { readonly code: "REPO_SLUG_UNDECLARED"; readonly message: string }
  | { readonly code: "REPO_PADDED"; readonly message: string }
  | { readonly code: "REPO_TOP_UNRECORDABLE"; readonly message: string }
  | { readonly code: "REPO_NAME_UNRESOLVED"; readonly message: string };

/** Build the refusals. Tests construct fixtures through this, never a hand-built literal. */
export const RepoCheckoutErrors = {
  empty: (): RepoCheckoutError => ({
    code: "REPO_EMPTY",
    message: "--repo is empty — name a checkout, or leave the flag out",
  }),
  lineBreak: (): RepoCheckoutError => ({
    code: "REPO_LINE_BREAK",
    message: "--repo carries a line break, and front-matter is read line by line",
  }),
  linkedWorktree: ({ requested, top }: { requested: string; top: string }): RepoCheckoutError => ({
    code: "REPO_LINKED_WORKTREE",
    message:
      `${requested} is a linked worktree, and a worktree is cut from a MAIN checkout — the row would lose its ` +
      "repo the day this worktree is removed. Pass the main checkout it was cut from",
    top,
  }),
  nameUnresolved: ({ message }: { message: string }): RepoCheckoutError => ({
    code: "REPO_NAME_UNRESOLVED",
    message,
  }),
  nested: ({ requested, top }: { requested: string; top: string }): RepoCheckoutError => ({
    code: "REPO_NESTED",
    message: `${requested} is inside the checkout ${top}, not its top — pass --repo ${top}`,
    top,
  }),
  notACheckout: ({ requested }: { requested: string }): RepoCheckoutError => ({
    code: "REPO_NOT_A_CHECKOUT",
    message: `${requested} is not a git checkout, so there is nothing to cut a worktree from`,
  }),
  padded: ({ requested }: { requested: string }): RepoCheckoutError => ({
    code: "REPO_PADDED",
    message:
      `--repo "${requested}" carries edge whitespace AND names a directory as typed, so trimming it would ` +
      "name a different one — rename the checkout, or pass the path without the whitespace",
  }),
  slugUndeclared: ({ message }: { message: string }): RepoCheckoutError => ({
    code: "REPO_SLUG_UNDECLARED",
    message,
  }),
  unrecordable: ({ top }: { top: string }): RepoCheckoutError => ({
    code: "REPO_TOP_UNRECORDABLE",
    message:
      `the checkout top "${top.replaceAll("\r", "\\r").replaceAll("\n", "\\n")}" begins or ends in whitespace or holds a line break, and a row's ` +
      "front-matter is read line by line and trimmed, so " +
      "it would parse back as a different directory — rename the checkout",
  }),
} as const;

/**
 * `owner/name` — a declared checkout's `origin`, never a path. The owner may not start with a dot, so `./x`
 * and `../x` stay relative paths rather than reading as owner `.` or `..`.
 */
const OWNER_NAME = /^([\w-][\w.-]*)\/([\w.-]+)$/u;

/**
 * A bare repository name. It may not start with a dot, so `.`, `..` and `./x` stay paths — `./x` is how a
 * directory relative to here is spelled, and the name refusal says so.
 */
const BARE_NAME = /^[\w-][\w.-]*$/u;

/**
 * The main checkout `--repo` names, or why it names none.
 *
 * Pure over its three seams so every branch is testable without a git or a profile. An `owner/name` resolves
 * through the declared checkouts' own origins, a bare name through the one declared checkout whose origin
 * carries it, and either resolved path is judged exactly as a typed one is. A bare name NEVER falls back to
 * being read as a directory: which of the two a person meant is exactly the guess the tick-188 row lost.
 *
 * A path must be the TOP of a MAIN checkout, because `cmux spawn` cuts a worktree from it: a subdirectory is
 * not where git works from, and a linked worktree is a seat that will be removed, taking the row's repo with
 * it. A main checkout nobody declared is accepted, because rows legitimately target repositories no profile
 * lists.
 *
 * @param requested what `--repo` was given, untrimmed
 * @param inspect what that path is on disk
 * @param bySlug resolves an `owner/name` to the declared checkout whose origin it is
 * @param byName resolves a bare repository name to the one declared checkout whose origin carries it
 * @returns the checkout path to write, or the refusal
 */
export function checkoutFor({
  requested,
  inspect,
  bySlug,
  byName,
}: {
  requested: string;
  inspect: (args: { path: string }) => CheckoutProbe;
  bySlug: (args: { owner: string; repo: string }) => Result<string, { readonly message: string }>;
  byName: (args: { name: string }) => Result<string, { readonly message: string }>;
}): Result<string, RepoCheckoutError> {
  if (/[\r\n]/u.test(requested)) {
    return err(RepoCheckoutErrors.lineBreak());
  }
  const slug = OWNER_NAME.exec(requested);
  if (slug !== null) {
    return bySlug({ owner: slug[1]!, repo: slug[2]! })
      .mapErr((error) => RepoCheckoutErrors.slugUndeclared({ message: error.message }))
      .andThen((declared) => mainCheckoutTop({ inspect, path: declared }));
  }
  if (BARE_NAME.test(requested)) {
    return byName({ name: requested })
      .mapErr((error) => RepoCheckoutErrors.nameUnresolved({ message: error.message }))
      .andThen((declared) => mainCheckoutTop({ inspect, path: declared }));
  }
  return mainCheckoutTop({ inspect, path: requested });
}

/**
 * The top of the main checkout at `path`, or why it is not one. A declared checkout's path goes through
 * this too: a profile may declare a seat's linked worktree, and the row would lose its repo with the seat.
 *
 * @param path the path to judge — the one `--repo` named, or the one a declared name resolved to
 * @param inspect what that path is on disk
 * @returns the checkout top, or the refusal
 */
function mainCheckoutTop({
  path,
  inspect,
}: {
  path: string;
  inspect: (args: { path: string }) => CheckoutProbe;
}): Result<string, RepoCheckoutError> {
  const probe = inspect({ path });
  switch (probe.kind) {
    case "main":
      // A row's front-matter is read line by line and trimmed, so a top with edge whitespace (r2 review) or a
      // line break (r3, reached through a symlink) would parse back as a different directory. Refused.
      if (probe.top !== probe.top.trim() || /[\r\n]/u.test(probe.top)) {
        return err(RepoCheckoutErrors.unrecordable({ top: probe.top }));
      }
      return ok(probe.top);
    case "nested":
      return err(RepoCheckoutErrors.nested({ requested: path, top: probe.top }));
    case "linked-worktree":
      return err(RepoCheckoutErrors.linkedWorktree({ requested: path, top: probe.top }));
    case "not-a-checkout":
      return err(RepoCheckoutErrors.notACheckout({ requested: path }));
    default: {
      const unhandled: never = probe;
      return unhandled;
    }
  }
}

/**
 * What a typed path is on disk: its git top, and whether that top is a main checkout or a linked worktree.
 *
 * @param path the path `--repo` named, relative ones resolved against this process's cwd
 * @returns what git says that path is
 */
function inspectRepoCheckout({ path }: { path: string }): CheckoutProbe {
  const absolute = resolve(path);
  let top: string;
  try {
    top = repoRootFromDirectory({ dir: absolute });
  } catch {
    return { kind: "not-a-checkout" };
  }
  if (!sameDirectory({ left: absolute, right: top })) {
    return { kind: "nested", top };
  }
  return isMainWorktree({ cwd: top }) ? { kind: "main", top } : { kind: "linked-worktree", top };
}

/**
 * {@link trimmedRepoValue} then {@link checkoutFor}, over the real disk and the declared checkouts of `home` — the
 * whole judgement both verbs call, so neither can trim, resolve or refuse differently.
 *
 * @param requested what `--repo` was given, untrimmed
 * @param home the state home whose profile declares the main checkouts
 * @returns the checkout path to write, or the refusal
 */
export function resolveRepoCheckout({
  requested,
  home,
}: {
  requested: string;
  home: string;
}): Result<string, RepoCheckoutError> {
  return trimmedRepoValue({ exists: ({ path }) => existsSync(path), raw: requested }).andThen((trimmed) =>
    checkoutFor({
      byName: ({ name }) => checkoutForRepoName({ home, name }),
      bySlug: ({ owner, repo }) => checkoutForRepo({ home, owner, repo }),
      inspect: inspectRepoCheckout,
      requested: trimmed,
    }),
  );
}

/**
 * `--repo` as typed, trimmed — and refused in the two cases trimming would change the answer. Here rather than
 * in either verb so `register` and `set-repo` cannot differ on it (r3 review: `set-repo` alone still trimmed
 * `R/repo ` into its sibling checkout `R/repo`).
 *
 * An empty value is refused because `resolve("")` is the process's own cwd, so an unset `--repo "$CHECKOUT"`
 * would record whichever checkout the caller stood in. A padded value is refused when its untrimmed path
 * itself exists, because then trimming names a different directory.
 *
 * @param raw what `--repo` was given, untouched
 * @param exists whether a path names something on disk, injectable so a test needs no filesystem
 * @returns the trimmed value to judge, or the refusal
 */
export function trimmedRepoValue({
  raw,
  exists,
}: {
  raw: string;
  exists: (args: { path: string }) => boolean;
}): Result<string, RepoCheckoutError> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return err(RepoCheckoutErrors.empty());
  }
  if (trimmed !== raw && exists({ path: raw })) {
    return err(RepoCheckoutErrors.padded({ requested: raw }));
  }
  return ok(trimmed);
}
