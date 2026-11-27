/**
 * How the worktree prune talks to git, and what it reads out of one checkout.
 *
 * Split out of `pruneScan.ts` when that file passed the size ratchet: the scan's DECISIONS and the edge it
 * reads them through are separate concerns, and the edge is the half with the hazards — armour, a buffer
 * bound, and a failure that must never read as a clean bill.
 */

import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { join } from "node:path";

import { gitEnv } from "../lib/gitRepo.js";
import { commandDrivers, filterAttributed, filterDriversIn } from "./pruneFilterListing.js";
import { unwatchedPaths } from "./pruneSalvage.js";
import { HOOKS_OFF } from "./salvageHooksOff.js";

/** Long enough to list a fortnight of trunk commits' paths, short enough that a wedged git is caught. */
const GIT_TIMEOUT_MS = 120_000;

/** Enough for `git status --porcelain` on a checkout with tens of thousands of files. */
export const GIT_MAX_BUFFER = 32 * 1024 * 1024;

/**
 * How one git command is run: the argv and a working directory in, its trimmed stdout or `null` out.
 *
 * A `null` is what makes every "could not determine" hold reason reachable, which is the whole point: this
 * verb must never read a failure as a clean bill.
 *
 * It is a SEAM — every function below takes one, defaulting to {@link realGit}, so a test can hand in a
 * plain fake and exercise the scan's real decisions without a repository on disk. A fake function passed in
 * is not a mock ([testing.md](../../.claude/rules/testing.md)), and `measureCandidates`'s `nowMs` is the
 * same shape for the same reason.
 *
 * `untrimmed` hands stdout back byte for byte, for a read whose trailing whitespace is data: a patch log's last
 * added line ending in a space must not hash the same as one that does not.
 */
export type GitRunner = (input: {
  args: readonly string[];
  cwd: string;
  stdin?: string;
  untrimmed?: boolean;
}) => string | null;

/**
 * Config every prune git command carries, so git's stat cache cannot vouch for a file it has not re-read.
 *
 * `status` and `git worktree remove`'s own dirty check trust the index's stat data, and a repository decides how
 * much of it: the r2 Codex review set `core.trustctime=false` and `core.checkStat=minimal`, wrote same-size
 * bytes over a tracked file, put its mtime back, and both called the tree clean while the removal deleted the
 * only copy. Every write moves ctime and nothing a user runs can set it back, so trusting ctime and checking
 * every stat field makes git re-hash that file. `core.untrackedCache` trusts a directory's mtime the same way.
 */
export const STRICT_STAT: readonly string[] = [
  "-c",
  "core.trustctime=true",
  "-c",
  "core.checkStat=default",
  "-c",
  "core.untrackedCache=false",
];

/**
 * A graft file no repository can hold, so git reads every commit's parents from the commit itself.
 *
 * `--no-replace-objects` does not reach `info/grafts`: the r1 Codex review grafted the trunk's tip onto a
 * divergent branch tip, and `merge-base --is-ancestor` then called a commit the trunk lacks its ancestor, so the
 * branch was deleted. Measured on git 2.54.0, a missing file turns grafts off silently, where `/dev/null` prints
 * the deprecation hint: `GIT_GRAFT_FILE=/nonexistent git merge-base --is-ancestor <branch> <trunk>; echo $?`.
 */
const NO_GRAFTS = "/nonexistent/slopweaver-no-grafts";

/**
 * The real one: a synchronous `git`, bounded by a timeout and a buffer, that never throws at its caller.
 *
 * Every read carries {@link HOOKS_OFF}, {@link STRICT_STAT} and {@link NO_GRAFTS}. The scan looks read-only and is not: `status --porcelain` fires
 * `post-index-change`, and `core.fsmonitor` names an executable git runs on its own initiative — so a
 * repository configuring either gets that code run, over the very index the capture has not protected yet.
 * A review pass reproduced the loss end-to-end with a monitor that ran `git add`, staged-only content
 * overwritten by the SCAN and then faithfully pushed in its overwritten form.
 *
 * @returns the command's trimmed stdout, or `null` when it failed for any reason at all
 */
export const realGit: GitRunner = ({ args, cwd, stdin, untrimmed }) => {
  try {
    const out = execFileSync("git", [...HOOKS_OFF, ...STRICT_STAT, ...args], {
      cwd,
      encoding: "utf8",
      // `ls-remote` reaches a remote, and a credential prompt on a tty would hang a prune nobody watches.
      env: { ...gitEnv(), GIT_GRAFT_FILE: NO_GRAFTS, GIT_TERMINAL_PROMPT: "0" },
      // An explicit "ignore" wins over `input`, so stdin is a pipe only when a read hands git its list there.
      ...(stdin === undefined ? {} : { input: stdin }),
      maxBuffer: GIT_MAX_BUFFER,
      stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      timeout: GIT_TIMEOUT_MS,
    });
    return untrimmed === true ? out : out.trim();
  } catch {
    return null;
  }
};

/**
 * Count the non-blank lines in a command's output.
 *
 * @returns how many there were, or `null` when the command itself failed — never a zero standing in for one
 */
export function countLines({ text }: { text: string | null }): number | null {
  return text === null ? null : text.split("\n").filter((line) => line.trim().length > 0).length;
}

/** The porcelain codes of a deletion whose content HEAD still holds; see {@link deletionsOnlyIn}. */
const DELETION_CODES: ReadonlySet<string> = new Set([" D", "D "]);

/**
 * Whether every entry in a porcelain status is a deletion of a tracked file and nothing else.
 *
 * Pure, and exported so the shape an interrupted `git worktree remove` leaves behind is a fixture rather
 * than something a test has to stage by killing a subprocess.
 *
 * Only the two codes whose content is still in HEAD count: ` D` (deleted from the working tree, the index
 * as HEAD has it) and `D ` (a staged deletion). A code that merely CONTAINS a `D` is not one: `MD` and
 * `AD` hold a staged blob that may be the only copy of an edit, and a `--force` removal would drop it
 * unreachable. A deliberate uncommitted deletion has the same two codes, and what it loses is
 * the intent to delete, never content — every byte is in HEAD.
 *
 * @param text the `git status --porcelain` output, or `null` when it could not be read
 * @returns true only when there is at least one entry and every one of them is a deletion
 */
export function deletionsOnlyIn({ text }: { text: string | null }): boolean {
  if (text === null) {
    return false;
  }
  const entries = text.split("\n").filter((line) => line.trim().length > 0);
  return entries.length > 0 && entries.every((line) => DELETION_CODES.has(line.slice(0, 2)));
}

/**
 * What each path is staged as — its mode and blob, as one `<mode> <sha>` string — from `git ls-files -s -z`.
 *
 * Pure, so the exact listing git produces is a fixture. Each record is `<mode> <sha> <stage>\t<path>`; a
 * conflicted path carries several stages, and any one of them differing is enough to count it, so every
 * stage is kept. The mode rides with the sha because a `chmod +x` changes no byte: the r2 Codex review
 * removed a tree whose only edit was an executable bit on a skip-worktree file.
 *
 * @param listing the NUL-separated `ls-files -s -z` output
 * @returns every staged `<mode> <sha>` per path
 */
export function stagedBlobs({ listing }: { listing: string }): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, string[]>();
  for (const record of listing.split("\0")) {
    const tab = record.indexOf("\t");
    if (tab < 0) {
      continue;
    }
    const [mode, sha] = record.slice(0, tab).split(" ");
    if (mode === undefined || sha === undefined) {
      continue;
    }
    const path = record.slice(tab + 1);
    const seen = out.get(path);
    if (seen === undefined) {
      out.set(path, [`${mode} ${sha}`]);
    } else {
      seen.push(`${mode} ${sha}`);
    }
  }
  return out;
}

/**
 * How many hidden files carry an edit — a mode or bytes on disk that are not what is staged for them.
 *
 * Pure. A path counts when it is not a regular file on disk, missing from the staged listing, staged under
 * more than one stage, or read as anything but its one staged `<mode> <sha>`. Every doubt counts, because
 * the count is a HOLD.
 *
 * @param hidden the paths git was told to stop reporting
 * @param staged each path's staged blob(s), from {@link stagedBlobs}
 * @param working each regular file's `<mode> <sha>` as read from disk, `undefined` for anything else
 * @returns the number of hidden files whose content is not what the index holds
 */
export function countHiddenEdits({
  hidden,
  staged,
  working,
}: {
  hidden: readonly string[];
  staged: ReadonlyMap<string, readonly string[]>;
  working: ReadonlyMap<string, string | undefined>;
}): number {
  return hidden.filter((path) => {
    const blobs = staged.get(path);
    const onDisk = working.get(path);
    return blobs?.length !== 1 || onDisk === undefined || blobs[0] !== onDisk;
  }).length;
}

/**
 * Whether any directory between the worktree and a tracked path is a symlink or another non-directory.
 *
 * @param file the path relative to the worktree, `/`-separated as git lists it
 * @param path the worktree root
 * @returns true when an ancestor exists and is not a real directory — a missing one leaves the file missing too
 */
function underSymlink({ file, path }: { file: string; path: string }): boolean {
  const parts = file.split("/").slice(0, -1);
  return parts.some((_, index) => {
    const entry = lstatSync(join(path, ...parts.slice(0, index + 1)), { throwIfNoEntry: false });
    return entry !== undefined && !entry.isDirectory();
  });
}

/**
 * Count the hidden files that actually carry an edit, or `null` when any read failed.
 *
 * MEASURED: every acme-admin checkout, the main one included, carries `S` (skip-worktree) on
 * `packages/web-ui/tsconfig.shared.json`, and in every one `git hash-object` of that file equals its
 * staged blob — yet counting the BIT held 67 of acme-admin's 83 worktrees, about 300 GB of real
 * `node_modules`. A bit over identical bytes hides nothing. Reproduce, in any acme-admin worktree:
 * `git ls-files -v | grep '^S'; git hash-object <path>; git ls-files -s <path>`.
 *
 * `hash-object --no-filters` hashes the raw bytes and runs nothing. The r3 Codex review broke the filtered
 * read with a clean filter that rewrote the file while git was reading it — a read that executes repository
 * code is not a read. The cost is conservative: a path whose checkout a filter rewrites (line endings, LFS)
 * hashes differently from its blob and counts as an edit, so it holds.
 *
 * Only a REGULAR file is hashed, by `lstat`, and its OWNER executable bit is read into the mode git would stage —
 * git reads that bit alone, so a `chmod 0655` of a 100755 file is a mode change.
 * `hash-object` follows a symlink, so a link to a file with the staged bytes hashed EQUAL — a review's
 * counterexample. A symlink, a directory or anything else where a file was is an edit. So is a regular file
 * reached through a symlinked DIRECTORY: `lstat` follows every component but the last, and a review replaced a
 * hidden file's parent with a link to the same bytes elsewhere.
 *
 * @param git how to run git
 * @param hidden the paths carrying a "stop looking" bit
 * @param path the worktree the paths are relative to
 * @returns the edited count, `0` when nothing is hidden, `null` when git could not answer
 */
function hiddenEditCount({
  git,
  hidden,
  path,
  staged,
}: {
  git: GitRunner;
  hidden: readonly string[];
  path: string;
  staged: ReadonlyMap<string, readonly string[]>;
}): number | null {
  if (hidden.length === 0) {
    return 0;
  }
  const present = hidden.flatMap((file) => {
    const entry = lstatSync(join(path, file), { throwIfNoEntry: false });
    if (entry === undefined || !entry.isFile() || underSymlink({ file, path })) {
      return [];
    }
    return [{ file, mode: (entry.mode & 0o100) === 0 ? "100644" : "100755" }];
  });
  // `--stdin-paths` reads one name per line and C-unquotes one opening with `"`, so either name is unreadable
  // there. The list rides stdin because every tracked path of a large checkout overflows an argv.
  if (present.some(({ file }) => file.includes("\n") || file.startsWith('"'))) {
    return null;
  }
  const hashes =
    present.length === 0
      ? ""
      : git({
          args: ["hash-object", "--no-filters", "--stdin-paths"],
          cwd: path,
          stdin: present.map(({ file }) => `${file}\n`).join(""),
        });
  if (hashes === null) {
    return null;
  }
  const lines = hashes.split("\n").filter((line) => line.length > 0);
  if (lines.length !== present.length) {
    return null;
  }
  const working = new Map<string, string | undefined>(
    present.map(({ file, mode }, index) => [file, `${mode} ${String(lines[index])}`]),
  );
  return countHiddenEdits({ hidden, staged, working });
}

/** The staged modes of a file whose bytes live in the working tree, as against a symlink's or a gitlink's. */
const REGULAR_MODES: ReadonlySet<string> = new Set(["100644", "100755"]);

/**
 * Every path staged as one regular file — what the apply's `every` read hashes raw.
 *
 * Pure. A symlink's target is read by `symlinkEditsNow` (`pruneSymlinks.ts`) and a gitlink is left to
 * `holdsSubmodule`: `hash-object --stdin-paths` follows a link into the file it names, and acme-admin tracks 40
 * of the two (`git -C ~/dev/acme-admin ls-files -s | grep -c '^120000\|^160000'`).
 *
 * @param staged each path's staged blob(s), from {@link stagedBlobs}
 * @returns the paths whose every stage carries a regular-file mode
 */
export function regularStaged({ staged }: { staged: ReadonlyMap<string, readonly string[]> }): readonly string[] {
  return [...staged]
    .filter(([, blobs]) => blobs.every((blob) => REGULAR_MODES.has(blob.slice(0, blob.indexOf(" ")))))
    .map(([file]) => file);
}

/**
 * How many files hidden from `status` carry an edit, read now — the apply's second look before a removal.
 *
 * The scan's count is a snapshot up to `--scan-budget` + `--budget` old by the time a tree is removed, and
 * `git worktree remove` cannot backstop it the way it backstops ordinary dirt: a file git was told to stop
 * reporting is exactly one it does not look at before deleting. A review reproduced it — a
 * skip-worktree file edited after the scan left `status` empty and the removal exited 0. So the removal
 * re-reads this, and anything but a definite zero keeps the tree.
 *
 * `gutted` is for an interrupted removal's tree, whose tracked files are already half-deleted: a hidden file
 * that is GONE there holds no bytes a removal could destroy, so it is not an edit — whoever deleted it. A hidden file still present is read exactly
 * as anywhere else — a review force-removed an interrupted tree over a skip-worktree edit made
 * after the scan, while the re-read skipped that class outright.
 *
 * A path a `filter` attribute names is hidden the same way, and read the same way: see {@link filteredPaths}.
 *
 * `every` reads EVERY regular tracked file that way, and is what the apply asks right before a removal. The
 * stat cache is the witness `status` trusts for a tracked file, and it cannot be made whole: Apple's git
 * compares ctime to the second, and a review wrote same-size bytes over a tracked file inside the
 * index refresh's own second, put its mtime back, and strict `status` and `git worktree remove` both called
 * the tree clean. Hashing the bytes asks nothing of the cache.
 *
 * @param path the worktree to read
 * @param git how to run git, so a test can supply a fake
 * @param gutted true when an interrupted removal already deleted part of the tree, so absence is not an edit
 * @param every true to compare every regular tracked file's raw bytes, not only those hidden from `status`
 * @returns the edited count, or `null` when git could not answer
 */
export function hiddenEditsNow({
  path,
  git = realGit,
  gutted = false,
  every = false,
}: {
  path: string;
  git?: GitRunner;
  gutted?: boolean;
  every?: boolean;
}): number | null {
  // A root that is no longer a real directory is read as unreadable: `git worktree remove` follows a symlinked
  // root into its target, which a review showed deleting a file the read had passed.
  const root = lstatSync(path, { throwIfNoEntry: false });
  const listing = root?.isDirectory() === true ? git({ args: ["ls-files", "-v", "-z"], cwd: path }) : null;
  // A name git printed in bytes that are not UTF-8 decodes to U+FFFD and names no file on disk, which a gutted
  // read would take for a deletion (on Linux). It is read as unreadable instead.
  if (listing === null || listing.includes("\uFFFD")) {
    return null;
  }
  const index = git({ args: ["ls-files", "-s", "-z"], cwd: path });
  if (index === null) {
    return null;
  }
  const staged = stagedBlobs({ listing: index });
  const filtered = filteredPaths({ asked: [...staged.keys()], git, path });
  if (filtered === null) {
    return null;
  }
  const everyFile = every ? regularStaged({ staged }) : [];
  const hidden = [...new Set([...unwatchedPaths({ listing }), ...filtered, ...everyFile])].filter(
    (file) =>
      !gutted || lstatSync(join(path, file), { throwIfNoEntry: false }) !== undefined || underSymlink({ file, path }),
  );
  return hiddenEditCount({ git, hidden, path, staged });
}

/**
 * Every tracked path a `filter` attribute names, or `null` when git could not say.
 *
 * A clean filter decides what `status` compares, so a lossy one makes a tracked edit invisible to every status
 * read, `--ignore-submodules=none` or not, and `git worktree remove` then deletes bytes no commit holds. The r2
 * Codex review did it with `filter.drop.clean='cat /dev/null'` over a file whose blob is empty. `check-attr`
 * reads attribute files and runs nothing, so these paths go to the same raw-byte comparison as a hidden file,
 * which never runs a filter either. MEASURED: neither slopweaver nor acme-admin sets a filter
 * anywhere, and the read takes 0.34s over acme-admin's 18,554 tracked files — `git ls-files -z | git
 * check-attr -z --stdin --all`, timed in `~/dev/acme-admin`.
 *
 * @param asked every tracked path, from the index
 * @param git how to run git
 * @param path the worktree to read
 * @returns the filtered paths, or `null` when the read failed
 */
function filteredPaths({
  asked,
  git,
  path,
}: {
  asked: readonly string[];
  git: GitRunner;
  path: string;
}): readonly string[] | null {
  const listing = attributeListing({ asked, git, path });
  return listing === null ? null : filterAttributed({ asked, listing });
}

/**
 * Every attribute the asked paths carry, as `check-attr -z --all` prints them; runs no filter.
 *
 * @param asked the tracked paths to ask about
 * @param git how to run git
 * @param path the worktree to read
 * @returns the NUL-separated listing, `""` for no paths, or `null` when git could not answer
 */
function attributeListing({
  asked,
  git,
  path,
}: {
  asked: readonly string[];
  git: GitRunner;
  path: string;
}): string | null {
  if (asked.length === 0) {
    return "";
  }
  return git({
    args: ["check-attr", "-z", "--stdin", "--all"],
    cwd: path,
    stdin: asked.map((file) => `${file}\0`).join(""),
  });
}

/**
 * Whether a git read of this tree could run a filter command, or `null` when git could not say.
 *
 * `status` runs a path's clean filter, and so does `git worktree remove`'s own dirty check — repository code
 * running AFTER every read this prune can make, able to write anywhere. The p3 Codex pass had one overwrite a
 * skip-worktree file after the raw read had passed it, while status still read deletions only, and `--force`
 * deleted the only copy. So a tree where a path names a driver that HAS a command is kept. The driver is
 * matched, not merely present: a GitHub runner's global git-lfs config gives `lfs` a command in every
 * repository. MEASURED: nothing on this machine configures one — `git config --global
 * --get-regexp '^filter\.'` and `git -C ~/dev/acme-admin config --get-regexp '^filter\.'` both print nothing.
 *
 * @param git how to run git
 * @param path the worktree to read
 * @returns true when some tracked path's `filter` driver has a clean or process command configured
 */
export function filterWouldRun({ git, path }: { git: GitRunner; path: string }): boolean | null {
  const config = git({ args: ["config", "--list", "-z"], cwd: path });
  if (config === null) {
    return null;
  }
  const configured = commandDrivers({ listing: config });
  if (configured.size === 0) {
    return false;
  }
  const index = git({ args: ["ls-files", "-s", "-z"], cwd: path });
  if (index === null) {
    return null;
  }
  const asked = [...stagedBlobs({ listing: index }).keys()];
  const listing = attributeListing({ asked, git, path });
  if (listing === null || filterAttributed({ asked, listing }) === null) {
    return null;
  }
  return [...filterDriversIn({ listing })].some((driver) => configured.has(driver));
}

/**
 * `git status --porcelain`, with the two settings a repository's config could otherwise turn against it.
 *
 * `status.showUntrackedFiles=no` hides an untracked file and `diff.ignoreSubmodules=all` hides a dirty
 * submodule, and either leaves a tree reading as deletions only — the one shape `--force` acts on. The p2
 * Codex plan pass reproduced the second with real git: status showed ` D top`, and `git worktree remove
 * --force` exited 0 and deleted the dirty submodule file. So the scan, the apply's re-read and the
 * partial-removal check all read through here, and cannot drift into three different questions.
 *
 * @param git how to run git
 * @param path the worktree to read
 * @returns the porcelain, or `null` when git could not answer
 */
export function workingTreeStatus({ git, path }: { git: GitRunner; path: string }): string | null {
  return git({
    args: ["status", "--porcelain", "--untracked-files=normal", "--ignore-submodules=none"],
    cwd: path,
  });
}

/** The mode git records a submodule's commit id under, in the index and in a tree. */
const GITLINK_MODE = "160000 ";

/**
 * Whether a worktree carries any submodule state `--force` would take with it, or `null` when git could not say.
 *
 * A superproject's HEAD records a submodule as one commit id, never its objects, and a linked worktree keeps a
 * checkout's repository under its own admin directory — so `--force` removing the tree removes the only copy of
 * anything in it no remote carries, and nothing here can prove what a remote carries of it. So ANY trace
 * counts: a gitlink in the index or in HEAD, or a `modules` directory beside the worktree's git dir.
 * `git submodule status` is not the witness: `submodule.<name>.active=false` lists a checkout as
 * uninitialised, and the r1 Codex review removed a submodule's only commit that way.
 *
 * @param git how to run git
 * @param path the worktree to read
 * @returns true when any trace is there, false when none is, `null` when a read failed
 */
export function holdsSubmodule({ git, path }: { git: GitRunner; path: string }): boolean | null {
  const index = git({ args: ["ls-files", "--stage", "-z"], cwd: path });
  const head = git({ args: ["ls-tree", "-r", "-z", "HEAD"], cwd: path });
  const gitDir = git({ args: ["rev-parse", "--absolute-git-dir"], cwd: path });
  if (index === null || head === null || gitDir === null || gitDir.length === 0) {
    return null;
  }
  const gitlink = [...index.split("\0"), ...head.split("\0")].some((record) => record.startsWith(GITLINK_MODE));
  if (gitlink) {
    return true;
  }
  try {
    return lstatSync(join(gitDir, "modules"), { throwIfNoEntry: false }) !== undefined;
  } catch {
    return null;
  }
}

/**
 * Read what the working tree itself says, in the two reads it takes rather than the one it looks like.
 *
 * `status --porcelain` cannot report a file git was told to stop reporting, so the count of those files is
 * read BESIDE it rather than derived from it. `-z` is what keeps a non-ASCII or newline-bearing name one
 * name; see `unwatchedPaths`. Both are reads — the scan never clears a bit, only the capture does.
 *
 * @param git how to run git, so a test can supply a fake
 * @returns the dirt count, whether that dirt is all deletions, and how many files are unreportable
 */
export function readWorkingTree({ git, path }: { git: GitRunner; path: string }): {
  deletionsOnly: boolean;
  dirtyCount: number | null;
  hiddenFromStatus: number | null;
} {
  const status = workingTreeStatus({ git, path });
  return {
    deletionsOnly: deletionsOnlyIn({ text: status }),
    dirtyCount: countLines({ text: status }),
    hiddenFromStatus: hiddenEditsNow({ git, path }),
  };
}
