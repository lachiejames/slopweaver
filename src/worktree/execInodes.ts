/**
 * Which files in a `node_modules` may never share an inode with yarn's content store, and what to do about
 * one that does.
 *
 * ## The defect this encodes
 *
 * `.yarnrc.yml` sets `nmMode: hardlinks-global`, so every file in every worktree's `node_modules` is a
 * hardlink to ONE entry under `~/.yarn/berry/store`. Measured on this machine: all 311 checkouts'
 * `@esbuild/darwin-arm64/bin/esbuild` were inode 850608791, which is also
 * `store/v1/93/<hash>.dat`. That is the affordable half of the
 * one-install-per-worktree rule (`deps.ts` has the 2.41 GiB → 316 KiB measurement) and, for a NATIVE
 * BINARY, it is a shared failure domain.
 *
 * Yarn's own `copyFileViaIndex` writes that inode IN PLACE. When a destination is already hardlinked
 * to the index entry and that entry's `mtime` is not yarn's `SAFE_TIME` sentinel (456789000), it drops to
 * `AtomicBehavior.Lock` and runs `writeFilePromise(indexPath, data)` — an open-truncate-write over the live
 * inode, with `autoRepair` unconditionally on. No store entry on this machine carries `SAFE_TIME`, so every
 * one of them is armed. Read from yarn 4.17.1's sources, and the `packageManager` pin has since moved to
 * 4.18.1 without disarming it: the shipped bundle is minified, so the only signal readable from the
 * artifact itself is `autoRepair`, and it appears exactly twice in each — identical across both bumps.
 * Reproduce with
 * `grep -c autoRepair ~/.proto/tools/yarn/{4.17.1,4.18.0,4.18.1}/bin/yarn.js`.
 *
 * What that write costs is worse than a race, and this is the fact the incident report did not have.
 * MEASURED, in a two-link fixture over a copy of the real esbuild binary (the fixture and its
 * numbers are in `src/__tests__/unit/worktree/execInodes.test.ts`'s header): while one link was rewritten with BYTE-IDENTICAL content six times,
 * 98 of 300 execs of the other link died `rc=137` — SIGKILL — and laps 204 through 300 died EVERY time.
 * Same size, same bytes, permanently unexecutable: macOS invalidates the vnode's code signature and never
 * revalidates it. So `stat` cannot see a poisoned binary, only an exec can, and the cure is a fresh inode —
 * which is exactly the `cp` + `mv` both sessions reached for (`ws:405`, `ws:411`). An
 * already-RUNNING process survives, because its pages are resident; it is the NEXT exec that dies.
 *
 * ## Why a shared exec store rather than a private copy per worktree
 *
 * The obvious fix — give every worktree its own copy of every native binary — was measured before it was
 * written, and it cannot be afforded. This tree carries **1117.5 MiB of Mach-O across 30 files**, and 323
 * worktrees hold a `node_modules` against 210 GiB free: 353 GiB, on a volume that has not got it.
 *
 * So the property is bought once instead of 323 times. Slopweaver keeps its own content-addressed exec
 * store, hardlinks every native binary to THAT, and re-applies it after each install. One extra copy of each
 * distinct binary exists machine-wide (1.1 GiB total, not per tree), and it is written only by
 * {@link execStoreEntryName}'s own seeding path — copy to a temp name, `rename` into place — never in place,
 * and never by yarn, which does not know it exists. A worktree linked to it therefore cannot be poisoned by
 * anything installing anywhere else.
 *
 * Pure: no filesystem, no subprocess. `execInodesApply.ts` is the effect edge.
 */

/**
 * The four byte sequences a Mach-O image starts with, as they are READ from the file.
 *
 * `cf fa ed fe` and `ce fa ed fe` are 64- and 32-bit little-endian images; `ca fe ba be` and `be ba fe ca`
 * are the two byte orders of a universal (fat) archive. Matching the header rather than a path pattern is
 * what keeps this from becoming a list of package names that goes stale: a dependency that starts shipping
 * a native binary is covered the day it does.
 */
const MACH_O_MAGICS: readonly (readonly number[])[] = [
  [0xcf, 0xfa, 0xed, 0xfe],
  [0xce, 0xfa, 0xed, 0xfe],
  [0xca, 0xfe, 0xba, 0xbe],
  [0xbe, 0xba, 0xfe, 0xca],
];

/** How many bytes {@link isMachO} needs. */
export const MACH_O_MAGIC_BYTES = 4;

/** File extensions that carry a mapped native image without necessarily carrying the exec bit. */
const NATIVE_EXTENSIONS: readonly string[] = [".node", ".dylib", ".so"];

/** The POSIX bits that make a file executable by anyone. */
const ANY_EXEC_BIT = 0o111;

/**
 * Whether a file's first bytes are a Mach-O image.
 *
 * @param header the file's leading bytes — fewer than {@link MACH_O_MAGIC_BYTES} is never a match
 * @returns true for a 32-bit, 64-bit or universal Mach-O
 */
export function isMachO({ header }: { header: Uint8Array }): boolean {
  return MACH_O_MAGICS.some((magic) => magic.every((byte, index) => header[index] === byte));
}

/**
 * Whether a directory entry is worth opening to check for a Mach-O header.
 *
 * The cheap filter that keeps the walk affordable: a `node_modules` here holds ~100k files and only ~400 of
 * them carry an exec bit or a native extension, so this decides on `stat` data alone and the header read
 * happens for those.
 *
 * @param path the entry's path, for its extension
 * @param mode the entry's `stat` mode bits
 * @returns true when the entry is executable by someone, or named like a loadable native image
 */
export function couldBeNativeImage({ path, mode }: { path: string; mode: number }): boolean {
  if ((mode & ANY_EXEC_BIT) !== 0) {
    return true;
  }
  return NATIVE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

/** One file's identity on disk — the pair that decides whether two paths are the same inode. */
export interface FileIdentity {
  /** The device the file lives on. */
  readonly dev: number;
  /** The inode number within that device. */
  readonly ino: number;
}

/**
 * The comparable key for one file identity.
 *
 * @param identity the device and inode to key
 * @returns a string usable in a `Set`, since a two-field object is compared by reference
 */
export function inodeKey({ identity }: { identity: FileIdentity }): string {
  return `${String(identity.dev)}:${String(identity.ino)}`;
}

/** What a native image's current inode means for the caller. */
export type ExecInodeVerdict = "private" | "shared";

/**
 * Whether a native image is already safe, or still shares an inode with something outside the exec store.
 *
 * A file whose inode is one the exec store owns is safe by construction — nothing writes those in place. Any
 * other inode is yarn's (or an older, already-poisoned one), and is what a sibling install can overwrite.
 *
 * @param file the image's own device and inode
 * @param storeInodes every inode the exec store currently owns, keyed by {@link inodeKey}
 * @returns `private` when the file already IS an exec-store inode, `shared` otherwise
 */
export function execInodeVerdict({
  file,
  storeInodes,
}: {
  file: FileIdentity;
  storeInodes: ReadonlySet<string>;
}): ExecInodeVerdict {
  return storeInodes.has(inodeKey({ identity: file })) ? "private" : "shared";
}

/**
 * The exec store's file name for one content hash.
 *
 * Content-addressed so two worktrees on the same lockfile share one entry, and so a dependency bump adds an
 * entry rather than rewriting one — the store is append-only in practice, which is the property that keeps
 * an in-place write from ever being the right thing to do here.
 *
 * @param sha256 the image's content hash, lowercase hex
 * @returns the entry's base name
 */
export function execStoreEntryName({ sha256 }: { sha256: string }): string {
  return `${sha256}.bin`;
}

/** What happened to one native image. */
export type ExecInodeAction = "already-private" | "relinked" | "shared" | "failed";

/** One native image's outcome, as a report line or a JSON row. */
export interface ExecInodeOutcome {
  /** The image's path, relative to the root that was walked. */
  readonly path: string;
  /** Its size in bytes, so a report can total the footprint it is talking about. */
  readonly size: number;
  /** What was done, or would have been done in report mode. */
  readonly action: ExecInodeAction;
  /** Why it failed, present only for `failed`. */
  readonly detail: string | undefined;
}

/** Everything one walk of one root found. */
export interface ExecInodeReport {
  /** The checkout or worktree that was walked. */
  readonly root: string;
  /** The exec store the images were linked to. */
  readonly execStore: string;
  /** Whether the walk was allowed to write, or only to report. */
  readonly applied: boolean;
  /** One row per native image found, in walk order. */
  readonly outcomes: readonly ExecInodeOutcome[];
}

/** How many images fell into one action, and how many bytes they account for. */
export interface ExecInodeTally {
  /** The number of images with this action. */
  readonly count: number;
  /** Their total size in bytes. */
  readonly bytes: number;
}

/**
 * Total one report by action.
 *
 * @param report the walk to summarise
 * @returns a tally per action, with every action present so a caller never has to guard a lookup
 */
export function tallyExecInodes({
  report,
}: {
  report: ExecInodeReport;
}): Readonly<Record<ExecInodeAction, ExecInodeTally>> {
  const tally: Record<ExecInodeAction, { count: number; bytes: number }> = {
    "already-private": { bytes: 0, count: 0 },
    failed: { bytes: 0, count: 0 },
    relinked: { bytes: 0, count: 0 },
    shared: { bytes: 0, count: 0 },
  };
  for (const outcome of report.outcomes) {
    const bucket = tally[outcome.action];
    bucket.count += 1;
    bucket.bytes += outcome.size;
  }
  return tally;
}

/** Bytes as MiB to one decimal, the unit every measurement in this module's header is stated in. */
function mib({ bytes }: { bytes: number }): string {
  return `${(bytes / 1048576).toFixed(1)} MiB`;
}

/**
 * The lines `worktree unshare` prints for one report.
 *
 * A clean root still prints a line rather than nothing: an empty section and a healthy one look identical,
 * and only one of them means anything was checked.
 *
 * @param report the walk to render
 * @returns the lines, outcome first, with one line per still-shared or failed image
 */
export function renderExecInodeReport({ report }: { report: ExecInodeReport }): readonly string[] {
  const tally = tallyExecInodes({ report });
  const verb = report.applied ? "relinked" : "SHARED with yarn's store";
  const moved = report.applied ? tally.relinked : tally.shared;
  const lines = [
    `${report.root}`,
    `  ${String(report.outcomes.length)} native image(s), ${mib({ bytes: tally["already-private"].bytes + moved.bytes + tally.failed.bytes })} — ` +
      `${String(tally["already-private"].count)} already private · ${String(moved.count)} ${verb} (${mib({ bytes: moved.bytes })})` +
      `${tally.failed.count > 0 ? ` · ${String(tally.failed.count)} FAILED` : ""}`,
  ];
  for (const outcome of report.outcomes) {
    if (outcome.action === "shared" || outcome.action === "failed") {
      lines.push(
        `  ${outcome.action === "failed" ? "FAILED" : "shared"} ${outcome.path}${outcome.detail === undefined ? "" : ` — ${outcome.detail}`}`,
      );
    }
  }
  return lines;
}

/**
 * Whether a report describes a root that still needs repairing.
 *
 * @param report the walk to judge
 * @returns true when any image is still shared with yarn's store, or could not be relinked
 */
export function execInodesNeedAttention({ report }: { report: ExecInodeReport }): boolean {
  return report.outcomes.some((outcome) => outcome.action === "shared" || outcome.action === "failed");
}
