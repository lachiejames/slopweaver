/**
 * A `github lap` tree's provenance — the marker the lap writes when it mints one, the path shape it is minted at, the
 * refs that count as keeping its HEAD, and the report directories the lap itself leaves in it — read by both sides:
 * the lap writes the marker (`../cli/commands/github/lapTree.ts`), and `worktree prune`'s `lap` class reads it
 * (`./pruneLapClass.ts`). It lives here, below the CLI, because product code never imports a verb module.
 *
 * ## Why prune needs to know it
 *
 * A lap disposes its detached tree in a `finally`, and a signal's default disposition skips every `finally`. A lap a
 * caller's deadline killed left the tree registered for good, and prune read it as an ordinary detached tree: held
 * forever by the never-waived rule about ignored files no build writes again, over the lap's OWN `.vitest-reports/`,
 * or as a detached HEAD on no remote. MEASURED: eight such trees, about 8 GB, each held by one of those two rules, on a
 * machine whose free disk sat under the line a seat needs to boot
 * (`git worktree list --porcelain | grep -c lap-trees.noindex`).
 *
 * ## Why a marker, and why in the private gitdir
 *
 * The lap lock is no liveness signal for a tree — `github lap --dry-run --land` mints one without it — so a tree says
 * itself who minted it: the minting process's pid AND its start stamp, so a pid the OS has since handed to another
 * process reads as a dead minter, never a live one. It sits in the tree's private gitdir: invisible to `git status`
 * and to the lap's own `git clean`, removed by `git worktree remove` with the registration, and kept beside the
 * registration when only the directory is deleted — which is the state prune scans.
 */
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import type { GitRunner } from "./pruneGit.js";
import { PRUNE_REMOTE } from "./pruneRemote.js";

/** The file the marker is written to, inside the tree's private gitdir. */
export const LAP_TREE_MARKER_FILE = "slopweaver-lap.json";

/** The `mkdtemp` prefix every lap tree is minted with, under the cache root's lap-trees directory. */
const LAP_TREE_PREFIX = "sw-lap-";

/** The characters `mkdtemp` appends: six, from `[A-Za-z0-9]`. */
const MKDTEMP_SUFFIX = /^[A-Za-z0-9]{6}$/u;

/** A full commit id, sha-1 or sha-256, lowercase as `rev-parse` prints it. */
const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/** The marker a lap writes into the private gitdir of each tree it mints. */
export interface LapTreeMarkerV1 {
  readonly version: 1;
  readonly kind: "github-lap-tree";
  /** The minting lap's pid. */
  readonly pid: number;
  /** That process's start stamp as `ps -o lstart=` prints it, so a recycled pid reads as a dead minter. */
  readonly processStart: string;
  /** The commit the tree was checked out at, read back after the add. */
  readonly mintedHead: string;
}

const MARKER_SCHEMA = z
  .object({
    kind: z.literal("github-lap-tree"),
    mintedHead: z.string().regex(COMMIT_ID),
    pid: z.number().int().positive(),
    processStart: z.string().min(1),
    version: z.literal(1),
  })
  .strict();

/** Why a marker could not be written or read as one. */
export type LapTreeMarkerError =
  | { readonly code: "LAP_MARKER_UNREADABLE"; readonly message: string; readonly path: string }
  | { readonly code: "LAP_MARKER_INVALID"; readonly message: string; readonly path: string }
  | { readonly code: "LAP_MARKER_UNWRITABLE"; readonly message: string; readonly path: string };

/** Factories for {@link LapTreeMarkerError}. */
const LapTreeMarkerErrors = {
  invalid: ({ path, why }: { path: string; why: string }): LapTreeMarkerError => ({
    code: "LAP_MARKER_INVALID",
    message: `the lap-tree marker at ${path} is not one: ${why}`,
    path,
  }),
  unreadable: ({ path, cause }: { path: string; cause: unknown }): LapTreeMarkerError => ({
    code: "LAP_MARKER_UNREADABLE",
    message: `the lap-tree marker at ${path} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
  unwritable: ({ path, cause }: { path: string; cause: unknown }): LapTreeMarkerError => ({
    code: "LAP_MARKER_UNWRITABLE",
    message: `the lap-tree marker at ${path} could not be written: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
} as const;

/**
 * Write the marker into a tree's private gitdir, atomically and readable by this user alone.
 *
 * @param gitDir the tree's own gitdir, as `git rev-parse --absolute-git-dir` answers it inside the tree
 * @returns nothing, or why the write failed
 */
export function writeLapTreeMarker({
  gitDir,
  marker,
}: {
  gitDir: string;
  marker: LapTreeMarkerV1;
}): Result<void, LapTreeMarkerError> {
  const path = join(gitDir, LAP_TREE_MARKER_FILE);
  try {
    writeFileAtomic({ contents: `${JSON.stringify(marker)}\n`, exactMode: true, fileMode: 0o600, path });
    return ok(undefined);
  } catch (error: unknown) {
    return err(LapTreeMarkerErrors.unwritable({ cause: error, path }));
  }
}

/**
 * Read a tree's marker. An ABSENT marker and an INVALID one are different answers on purpose: an explicit run may
 * take an unmarked legacy tree, and must never read a malformed or unreadable marker as no marker at all.
 *
 * @param gitDir the tree's own gitdir
 * @returns the marker, `null` when no marker file exists, or why the file is not a readable marker
 */
export function readLapTreeMarker({ gitDir }: { gitDir: string }): Result<LapTreeMarkerV1 | null, LapTreeMarkerError> {
  const path = join(gitDir, LAP_TREE_MARKER_FILE);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return ok(null);
    }
    return err(LapTreeMarkerErrors.unreadable({ cause: error, path }));
  }
  return parseLapTreeMarker({ path, text });
}

/**
 * Parse a marker file's text. PURE.
 *
 * @param path where the text was read, for the error
 * @param text the file's contents
 * @returns the marker, or why the text is not one
 */
export function parseLapTreeMarker({
  path,
  text,
}: {
  path: string;
  text: string;
}): Result<LapTreeMarkerV1, LapTreeMarkerError> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error: unknown) {
    return err(LapTreeMarkerErrors.invalid({ path, why: error instanceof Error ? error.message : String(error) }));
  }
  const parsed = MARKER_SCHEMA.safeParse(json);
  if (!parsed.success) {
    return err(
      LapTreeMarkerErrors.invalid({ path, why: parsed.error.issues.map((issue) => issue.message).join("; ") }),
    );
  }
  return ok(parsed.data);
}

/**
 * Whether `path` has exactly a lap tree's shape: `<lap-trees root>/sw-lap-<6 chars>` for one spelling of the root.
 * The shape alone never makes a tree a `lap`: it only selects which provenance rules judge it. PURE.
 *
 * @param path the worktree path git registered
 * @param roots every spelling of the cache root's lap-trees directory
 * @returns true only for that exact shape
 */
export function lapTreeShape({ path, roots }: { path: string; roots: readonly string[] }): boolean {
  const name = basename(path);
  if (!name.startsWith(LAP_TREE_PREFIX) || !MKDTEMP_SUFFIX.test(name.slice(LAP_TREE_PREFIX.length))) {
    return false;
  }
  const parent = dirname(path);
  return roots.some((root) => root.replace(/\/+$/u, "") === parent);
}

/**
 * Both spellings of the lap-trees directory: as the cache root names it, and as the filesystem resolves it, since
 * git registers the realpath.
 *
 * @param lapTrees the cache root's lap-trees directory
 * @returns the directory, and its realpath when that differs and can be read
 */
export function lapTreeRoots({ lapTrees }: { lapTrees: string }): readonly string[] {
  try {
    const real = realpathSync(lapTrees);
    return real === lapTrees ? [lapTrees] : [lapTrees, real];
  } catch {
    return [lapTrees];
  }
}

/**
 * The ignored directories a lap writes into its own tree, from the tree's root: its vitest reports, which its clean
 * deliberately spares, and the coverage and browser-test outputs a lane writes. Root-anchored, and consulted by the
 * `lap` class ONLY — an ordinary tree holding the same directory is still held by the rule about ignored files no
 * build writes again.
 */
export const LAP_OUTPUT_DIRS: readonly string[] = [
  ".vitest-reports/",
  "coverage/",
  "coverage-integration/",
  "playwright-report/",
  "test-results/",
];

/**
 * The ignored entries a lap did not write itself. PURE.
 *
 * @param ignoredWork the tree's ignored entries no build writes again, as `ls-files --directory` lists them
 * @returns every entry that is not one of {@link LAP_OUTPUT_DIRS} or inside one
 */
export function unexpectedLapWork({ ignoredWork }: { ignoredWork: readonly string[] }): readonly string[] {
  return ignoredWork.filter((entry) => !LAP_OUTPUT_DIRS.some((dir) => entry === dir || entry.startsWith(dir)));
}

/**
 * The ref namespaces whose refs count as somebody MEANING to keep a commit — an allowlist, so a namespace nobody
 * listed never admits a removal by default. Not counted: `refs/tmp/` (scratch, anything may delete it),
 * `refs/slopweaver/lap/` (the next lap of that pull request moves it), `refs/stash`, every namespace not here, and
 * every remote but {@link PRUNE_REMOTE}: an `archive` remote of another history is not where this work is backed up.
 */
const LAP_WITNESS_NAMESPACES: readonly string[] = [
  `refs/remotes/${PRUNE_REMOTE}/`,
  "refs/tags/",
  "refs/heads/",
  "refs/slopweaver/pruned-lap/",
  "refs/slopweaver/operator-lap/",
];

/** Where a removed lap tree's HEAD is pinned before the removal, so a superseded head survives its tree. */
export const PINNED_LAP_REFS = "refs/slopweaver/pruned-lap/";

/** Where an operator pins an unreachable legacy lap tree's HEAD, by hand, to let the explicit run take it. */
export const OPERATOR_LAP_REFS = "refs/slopweaver/operator-lap/";

/**
 * The first ref that witnesses `head`, from a `for-each-ref --contains` listing over
 * {@link LAP_WITNESS_NAMESPACES}. PURE.
 *
 * A `salvage/<this tree's own slug>-…` branch is not a witness: prune's own failed salvage loop minted it from this
 * very tree, so it records no decision by anybody to keep the commit.
 *
 * @param listing one ref name per line
 * @param treePath the lap tree's path, whose basename is its salvage slug
 * @returns the witnessing ref, or `null` when none in the listing counts
 */
export function lapWitnessFrom({ listing, treePath }: { listing: string; treePath: string }): string | null {
  const ownSalvage = `refs/heads/salvage/${basename(treePath).replaceAll(/[^A-Za-z0-9._-]/gu, "-")}-`;
  const witness = listing
    .split("\n")
    .map((line) => line.trim())
    .find(
      (ref) =>
        ref !== "" &&
        LAP_WITNESS_NAMESPACES.some((namespace) => ref.startsWith(namespace)) &&
        !ref.startsWith(ownSalvage),
    );
  if (witness === undefined) {
    return null;
  }
  return witness;
}

/**
 * What the scan read of a lap-shaped tree's provenance. An absent fact on a tree's `WorktreeFacts` means the path is not
 * lap-shaped at all, and the ordinary rules judge it. `head` is read here rather than taken from the detached-tree
 * facts, because prune's salvage loop switches a lap tree onto a `salvage/` branch, and a branch-backed tree carries no
 * detached HEAD fact; `null` when it could not be read.
 */
export type LapTreeFacts =
  /** No marker file: a tree minted before markers existed, or one whose minting lap died between add and mark. */
  | { readonly kind: "unmarked"; readonly head: string | null; readonly witness: string | null | undefined }
  /** A marker file that could not be read or is not a marker — never read as no marker. */
  | { readonly kind: "invalid"; readonly reason: string }
  /** A marker, and whether the process it names is still that process. */
  | {
      readonly kind: "marked";
      readonly head: string | null;
      readonly marker: LapTreeMarkerV1;
      readonly holderLive: boolean;
    };

/**
 * Read a lap tree's provenance, detached or on a branch, or `undefined` for any other tree. A marker in the private
 * gitdir is provenance wherever the tree sits, so a lap minted under another cache home is still judged by it; an
 * UNMARKED tree is a lap tree only at a lap-shaped path.
 *
 * @param git how to run git
 * @param path the worktree path git registered
 * @param roots every spelling of the lap-trees directory
 * @param holderLive whether the process a marker names is still that process — `holderRunning` over `liveStartOf`
 * in production, so a pid since handed to another process, or a zombie, reads as spent
 * @returns the provenance fact
 */
export function readLapTreeFacts({
  git,
  path,
  roots,
  holderLive,
}: {
  git: GitRunner;
  path: string;
  roots: readonly string[];
  holderLive: (holder: { readonly pid: number; readonly start: string }) => boolean;
}): LapTreeFacts | undefined {
  const shaped = lapTreeShape({ path, roots });
  const gitDir = git({ args: ["rev-parse", "--absolute-git-dir"], cwd: path, untrimmed: true })?.replace(/\n$/u, "");
  if (gitDir == null || gitDir === "") {
    return shaped ? { kind: "invalid", reason: "its private gitdir could not be read" } : undefined;
  }
  const marker = readLapTreeMarker({ gitDir });
  if (marker.isErr()) {
    return { kind: "invalid", reason: marker.error.message };
  }
  if (!shaped && marker.value === null) {
    return undefined;
  }
  const read = git({ args: ["rev-parse", "--verify", "--quiet", "HEAD"], cwd: path });
  const head = read !== null && COMMIT_ID.test(read) ? read : null;
  if (marker.value === null) {
    const witness = head === null ? undefined : readLapWitness({ git, head, path });
    return { head, kind: "unmarked", witness };
  }
  const found = marker.value;
  return { head, holderLive: holderLive({ pid: found.pid, start: found.processStart }), kind: "marked", marker: found };
}

/**
 * The ref that witnesses a lap tree's HEAD, read from the repository.
 *
 * @param git how to run git
 * @param path the lap tree
 * @param head the commit to find a witness for
 * @returns the witnessing ref; `null` when none does; `undefined` when git could not be asked
 */
function readLapWitness({
  git,
  path,
  head,
}: {
  git: GitRunner;
  path: string;
  head: string;
}): string | null | undefined {
  const listing = git({
    args: ["for-each-ref", "--contains", head, "--format=%(refname)", ...LAP_WITNESS_NAMESPACES],
    cwd: path,
  });
  if (listing === null) {
    return undefined;
  }
  return lapWitnessFrom({ listing, treePath: path });
}
