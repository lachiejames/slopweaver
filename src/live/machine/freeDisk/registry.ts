/**
 * `machine free-disk`'s closed registry: the only targets it acts on, the exact paths each derives, and the
 * targets the owner ruled kept, each with its reason. Nothing outside it is reachable: there is no path flag, so
 * no argument can name a directory the registry does not. Which APPLICATIONS are ruled removable is one
 * installation's fact, so that list is read from the state home (`bundleRuling.ts`), never written here.
 *
 * Pure: it derives paths from a user home and a main checkout, and never reads either.
 */
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import type { BundleRuling } from "./bundleRuling.js";
import { type FreeDiskError, FreeDiskErrors } from "./errors.js";

/** The targets a caller can name, in the order the usage text lists them. */
const FREE_DISK_TARGETS = ["package-caches", "docker-data", "before-setup-copy", "app"] as const;

/** One target a caller can name. */
export type FreeDiskTargetName = (typeof FREE_DISK_TARGETS)[number];

/** A parsed request: the target and, for `app`, the bundle it names. */
export type FreeDiskTarget =
  | { readonly kind: "package-caches" }
  | { readonly kind: "docker-data" }
  | { readonly kind: "before-setup-copy" }
  | { readonly kind: "app"; readonly bundle: string };

/**
 * Names a caller might reach for that the owner ruled kept, so the refusal says why rather than "unknown":
 * npm's and Yarn's caches are read by every worktree install, and Slopweaver's own cache holds lap worktrees,
 * a hardlinked binary store and a live plugin export (see {@link SLOPWEAVER_CACHE_KEPT}).
 */
export const PROTECTED_TARGETS: Readonly<Record<string, string>> = {
  npm: "every worktree install reads npm's cache, and the owner ruled it kept",
  "slopweaver-cache": "nothing under Slopweaver's own cache is a plain rebuildable cache; package-caches reports why",
  yarn: "every worktree install reads Yarn's cache, and the owner ruled it kept",
};

/** One package cache the owner ruled clearable: its label and where it sits under the user's Library. */
export interface PackageCacheEntry {
  readonly label: string;
  /** The directory's name under `~/Library/Caches`. */
  readonly cacheDir: string;
}

/** The four package caches the owner ruled clearable — each tool rebuilds its own on its next install. */
export const CLEARABLE_PACKAGE_CACHES: readonly PackageCacheEntry[] = [
  { cacheDir: "pypoetry", label: "Poetry" },
  { cacheDir: "pnpm", label: "pnpm" },
  { cacheDir: "pip", label: "pip" },
  { cacheDir: "pipenv", label: "pipenv" },
];

/**
 * The children of Slopweaver's own cache root, each kept for its reason. The exec store's is checked rather than
 * assumed: `find ~/Library/Caches/slopweaver/exec-store -type f -links 1` lists the files removing it would free.
 */
export const SLOPWEAVER_CACHE_KEPT: Readonly<Record<string, string>> = {
  "codex-plugin": "the Codex marketplace's slopweaver entry points at this export",
  console: "the console's saved readings, read by a live console",
  desktop: "the last desktop update's outcome, read when a call restarts",
  "docs-site": "live run records and call leases for every console the fleet serves",
  "exec-store": "every file is hardlinked into a checkout's node_modules, so removing it frees nothing",
  "lap-trees.noindex": "registered git worktrees from github lap; worktree prune owns them",
};

/** The reason an unrecognised child of Slopweaver's cache root stays. */
export const UNKNOWN_SLOPWEAVER_CACHE_CHILD =
  "not a child the owner ruled rebuildable, so it is kept and named rather than skipped";

/** The Docker Desktop data file, below the user home. */
const DOCKER_RAW_RELATIVE = "Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw";

/**
 * The image every Docker command runs in: already on this machine (`--pull never`), so the verb downloads
 * nothing. Any image carrying util-linux's `nsenter` would do; this one serves the local store's own database.
 */
const DOCKER_LOCAL_IMAGE = "postgres:17";

/**
 * The VM's own data mount, the one filesystem `Docker.raw` backs. Never `fstrim -a`: MEASURED, `fstrim -av -n`
 * inside the VM lists the host's virtiofs shares (`/run/host_virtiofs/Users` and the rest) beside `/dev/vda1`.
 */
export const DOCKER_VM_DATA_MOUNT = "/var/lib";

/** The prefix every in-VM command shares: a throwaway privileged container entering PID 1's mount namespace. */
const DOCKER_VM_PREFIX: readonly string[] = [
  "run",
  "--rm",
  "--pull",
  "never",
  "--privileged",
  "--pid=host",
  DOCKER_LOCAL_IMAGE,
  "nsenter",
  "-t",
  "1",
  "-m",
  "--",
];

/**
 * The `docker` argv that TRIMs the VM's data mount, which hands its unused blocks back to `Docker.raw`'s host
 * file. Nothing is deleted: TRIM only tells the disk which blocks the filesystem no longer uses.
 *
 * @param dryRun whether `fstrim` should only say what it would do
 * @returns the argv after `docker`
 */
export function dockerTrimArgv({ dryRun }: { dryRun: boolean }): readonly string[] {
  if (dryRun) {
    return [...DOCKER_VM_PREFIX, "fstrim", "-n", "-v", DOCKER_VM_DATA_MOUNT];
  }
  return [...DOCKER_VM_PREFIX, "fstrim", "-v", DOCKER_VM_DATA_MOUNT];
}

/**
 * The `docker` argv that reads the VM data mount's own `df -k`, the space its filesystem really uses.
 *
 * @returns the argv after `docker`
 */
export function dockerVmDfArgv(): readonly string[] {
  return [...DOCKER_VM_PREFIX, "df", "-k", DOCKER_VM_DATA_MOUNT];
}

/** The applications root every bundle is looked up in. */
export const APPLICATIONS_ROOT = "/Applications";

/** The suffix a pre-setup copy carries beside the main checkout. */
const BEFORE_SETUP_SUFFIX = ".before-setup";

/**
 * Whether a string carries an ASCII control character.
 *
 * @returns true when any code unit is U+0000–U+001F or U+007F
 */
function hasControlCharacter({ text }: { text: string }): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve `--bundle` to one ruled-removable bundle's exact name. The `.app` suffix is optional; a path, a
 * control character, a bundle the ruling keeps or any application it does not name removable is refused.
 *
 * @param named what the caller typed
 * @param ruling the state home's bundle ruling
 * @returns the bundle's exact file name under {@link APPLICATIONS_ROOT}, or the refusal
 */
export function resolveBundle({
  named,
  ruling,
}: {
  named: string;
  ruling: BundleRuling;
}): Result<string, FreeDiskError> {
  const trimmed = named.trim();
  const pathLike = trimmed.includes("/") || trimmed === "." || trimmed === ".." || trimmed.startsWith(".");
  if (trimmed.length === 0 || pathLike || hasControlCharacter({ text: trimmed })) {
    return err(FreeDiskErrors.bundleNameInvalid({ named }));
  }
  const bundle = trimmed.endsWith(".app") ? trimmed : `${trimmed}.app`;
  const lower = bundle.toLowerCase();
  if (ruling.kept.some((kept) => kept.toLowerCase() === lower)) {
    return err(FreeDiskErrors.bundleProtected({ bundle }));
  }
  const approved = ruling.removable.find((removable) => removable.toLowerCase() === lower);
  if (approved === undefined) {
    return err(FreeDiskErrors.bundleNotApproved({ approved: ruling.removable, bundle }));
  }
  return ok(approved);
}

/**
 * Resolve the positional target name, refusing a protected name with its reason and an unknown one with the list.
 *
 * @param named the positional the caller typed
 * @returns the target's name, or the refusal
 */
export function resolveTargetName({ named }: { named: string }): Result<FreeDiskTargetName, FreeDiskError> {
  // `Object.hasOwn`, never a bare index: `PROTECTED_TARGETS["toString"]` is Object.prototype's function.
  if (Object.hasOwn(PROTECTED_TARGETS, named)) {
    return err(FreeDiskErrors.protectedTarget({ named, why: PROTECTED_TARGETS[named]! }));
  }
  const found = FREE_DISK_TARGETS.find((target) => target === named);
  if (found === undefined) {
    return err(FreeDiskErrors.unsupportedTarget({ named, targets: FREE_DISK_TARGETS }));
  }
  return ok(found);
}

/** Every path the registry derives, from the two roots it is given. */
export interface FreeDiskPaths {
  readonly libraryCaches: string;
  readonly slopweaverCacheRoot: string;
  readonly npmCache: string;
  readonly yarnCache: string;
  readonly dockerRaw: string;
  readonly trash: string;
}

/**
 * Derive every path below the user's home.
 *
 * @param userHome the absolute user home
 * @returns the derived paths
 */
export function freeDiskPaths({ userHome }: { userHome: string }): FreeDiskPaths {
  const libraryCaches = join(userHome, "Library", "Caches");
  return {
    dockerRaw: join(userHome, DOCKER_RAW_RELATIVE),
    libraryCaches,
    npmCache: join(userHome, ".npm"),
    slopweaverCacheRoot: join(libraryCaches, "slopweaver"),
    trash: join(userHome, ".Trash"),
    yarnCache: join(libraryCaches, "Yarn"),
  };
}

/**
 * The pre-setup copy's path: the main checkout's sibling carrying {@link BEFORE_SETUP_SUFFIX}, and nothing else.
 *
 * @param mainCheckout the main checkout's absolute path
 * @returns the copy's absolute path
 */
export function beforeSetupCopyPath({ mainCheckout }: { mainCheckout: string }): string {
  return `${mainCheckout}${BEFORE_SETUP_SUFFIX}`;
}
