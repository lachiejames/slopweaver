/**
 * What, besides the commit, decides the bytes a checkout writes — so a reused snapshot slot can tell when its
 * files were written under different rules.
 *
 * `reset --hard` rewrites only the paths whose blobs changed. An unchanged blob keeps whatever bytes the slot's
 * last checkout wrote, so a checkout rule that changed between two passes leaves those bytes stale where a fresh
 * checkout would not (`core.autocrlf` flipped between two leases served LF where a fresh copy served
 * CRLF). The rules live in four places outside the commit: the checkout-affecting config keys, the repository's
 * `info/attributes`, and the global and system attributes files. {@link checkoutFingerprint} digests all four; a slot whose
 * recorded fingerprint differs is rebuilt rather than reset (`./snapshotPool.ts`).
 *
 * What a digest cannot see is a filter PROGRAM whose behaviour changed while its config line did not. So a tree whose attributes route any file through a configured smudge or process filter is
 * not pooled at all — {@link smudgingDriver} names the driver and the pool refuses, leaving that pass to a fresh
 * snapshot. A configured driver nothing routes to, such as a machine-wide LFS install, costs nothing.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runGitChecked } from "./gitRun.js";
import { isErrno } from "./snapshotLease.js";

/** Config keys that change the bytes or modes a checkout writes for an unchanged blob. */
const CHECKOUT_KEY =
  /^(core\.(autocrlf|eol|symlinks|filemode|ignorecase|precomposeunicode|checkroundtripencoding|attributesfile)|filter\.)/;

/** A config line naming a filter driver's smudge or long-running process command, capturing the driver. */
const SMUDGE_KEY = /^filter\.(.+)\.(?:smudge|process)=/;

/**
 * How the snapshot pool runs git: `runGitChecked` in production, which throws on a non-zero exit, and a
 * scripted fake in a unit test, so the pool's decisions are tested without a real repository.
 */
export type SnapshotGit = (call: {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly label: string;
  /** When the child is killed; a whole-tree write passes `GIT_TREE_WRITE_TIMEOUT_MS`, a read omits it. */
  readonly timeoutMs?: number;
}) => string;

/**
 * A digest of every checkout rule outside the commit, as the repository sees it now.
 *
 * @param commonGitDir the repository's real common git dir, which holds `info/attributes`
 * @param git how git is run — a unit test passes a scripted fake
 * @param off the git prefix every snapshot command runs under
 * @param repoRoot the repository the snapshot is taken from
 * @returns a sha256 hex digest; equal digests mean a reset slot's unchanged files are still right
 */
export function checkoutFingerprint({
  commonGitDir,
  git = runGitChecked,
  off,
  repoRoot,
}: {
  commonGitDir: string;
  git?: SnapshotGit;
  off: readonly string[];
  repoRoot: string;
}): string {
  const config = git({ args: [...off, "config", "--list", "--includes"], cwd: repoRoot, label: "git config" })
    .split("\n")
    .filter((line) => CHECKOUT_KEY.test(line));
  const parts = [config.join("\n"), ...outsideAttributes({ commonGitDir, git, off, repoRoot })];
  return createHash("sha256")
    .update(
      parts
        .map((part) => {
          // An absent file is part of the rules too, and must not hash like an empty one.
          if (part === undefined) {
            return "\u0001absent";
          }
          return part;
        })
        .join("\u0000"),
    )
    .digest("hex");
}

/**
 * The first configured smudge or process filter driver that the commit's attributes or any attributes file
 * outside it names with `filter=` — a reused slot cannot vouch for that program's output.
 *
 * Any `filter=<name>` counts, including one inside a macro definition, so a driver reached through a macro is
 * caught too; an over-match only sends a pass to a fresh snapshot.
 *
 * @param attributeBlobs the blob ids of every `.gitattributes` in the commit's tree
 * @param commonGitDir the repository's real common git dir, which holds `info/attributes`
 * @param git how git is run — a unit test passes a scripted fake
 * @param off the git prefix every snapshot command runs under
 * @param repoRoot the repository the snapshot is taken from
 * @returns the driver name, or undefined when no file is routed through a smudging filter
 */
export function smudgingDriver({
  attributeBlobs,
  commonGitDir,
  git = runGitChecked,
  off,
  repoRoot,
}: {
  attributeBlobs: readonly string[];
  commonGitDir: string;
  git?: SnapshotGit;
  off: readonly string[];
  repoRoot: string;
}): string | undefined {
  const texts = [
    ...attributeBlobs.map((blob) =>
      git({ args: [...off, "cat-file", "blob", blob], cwd: repoRoot, label: "git cat-file" }),
    ),
    ...outsideAttributes({ commonGitDir, git, off, repoRoot }),
  ];
  const named = new Set(
    texts.flatMap((text) =>
      text === undefined ? [] : [...text.matchAll(/(?:^|\s)filter=(\S+)/gm)].map((found) => found[1]!),
    ),
  );
  const smudging = git({ args: [...off, "config", "--list", "--includes"], cwd: repoRoot, label: "git config" })
    .split("\n")
    .map((line) => SMUDGE_KEY.exec(line)?.[1])
    .filter((driver): driver is string => driver !== undefined);
  return smudging.find((driver) => named.has(driver));
}

/**
 * A file's contents, or `undefined` when it does not exist.
 *
 * @param path the file to read
 * @returns its utf8 contents, or undefined when absent
 */
export function readIfPresent({ path }: { path: string }): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (isErrno({ codes: ["ENOENT", "ENOTDIR"], error })) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Every attributes file outside the commit, each as text or `undefined` when absent: the repository's
 * `info/attributes`, then the global and system files at the paths git itself reports — `git var` honours
 * `core.attributesfile` and the XDG default, and names the system file a fresh checkout reads too.
 */
function outsideAttributes({
  commonGitDir,
  git,
  off,
  repoRoot,
}: {
  commonGitDir: string;
  git: SnapshotGit;
  off: readonly string[];
  repoRoot: string;
}): readonly (string | undefined)[] {
  const gitVar = ({ name }: { name: string }): string =>
    // Only git's newline comes off: a path may end in a space.
    git({ args: [...off, "var", name], cwd: repoRoot, label: `git var ${name}` }).replace(/\n$/, "");
  return [
    readIfPresent({ path: join(commonGitDir, "info", "attributes") }),
    readIfPresent({ path: gitVar({ name: "GIT_ATTR_GLOBAL" }) }),
    readIfPresent({ path: gitVar({ name: "GIT_ATTR_SYSTEM" }) }),
  ];
}
