/**
 * `machine free-disk`'s typed failures: one union for the closed target registry, the safety checks a plan runs
 * over what it read off the machine, and the act itself. A caller branches on `code` and displays `message`.
 */

/** A target name the registry does not carry. */
export interface UnsupportedTargetError {
  readonly code: "UNSUPPORTED_TARGET";
  readonly message: string;
  readonly named: string;
}

/** A target the owner ruled kept, named so the refusal says why rather than "unknown". */
export interface ProtectedTargetError {
  readonly code: "PROTECTED_TARGET";
  readonly message: string;
  readonly named: string;
}

/** An `--bundle` value that is a path, carries a control character or is empty. */
export interface BundleNameInvalidError {
  readonly code: "BUNDLE_NAME_INVALID";
  readonly message: string;
  readonly named: string;
}

/** The state home's bundle ruling is there and cannot be read as one. */
export interface BundleRulingInvalidError {
  readonly code: "BUNDLE_RULING_INVALID";
  readonly message: string;
  readonly path: string;
}

/** An application the owner ruled kept. */
export interface BundleProtectedError {
  readonly code: "BUNDLE_PROTECTED";
  readonly message: string;
  readonly bundle: string;
}

/** A well-formed application name the owner has not ruled on. */
export interface BundleNotApprovedError {
  readonly code: "BUNDLE_NOT_APPROVED";
  readonly message: string;
  readonly bundle: string;
}

/** A path whose real location is not the one the registry derived. */
export interface PathOutsideExpectedRootError {
  readonly code: "PATH_OUTSIDE_EXPECTED_ROOT";
  readonly message: string;
  readonly path: string;
  readonly realPath: string;
}

/** A target that is itself a symbolic link. */
export interface SymlinkRefusedError {
  readonly code: "SYMLINK_REFUSED";
  readonly message: string;
  readonly path: string;
}

/** A target that is not the kind of file system object the registry names. */
export interface WrongKindError {
  readonly code: "WRONG_KIND";
  readonly message: string;
  readonly path: string;
  readonly expected: "directory" | "regular file";
}

/** The main checkout the pre-setup copy is derived from could not be proven. */
export interface MainCheckoutUnprovenError {
  readonly code: "MAIN_CHECKOUT_UNPROVEN";
  readonly message: string;
}

/** The main checkout the run stands in is not one `profile.json` declares. */
export interface MainCheckoutUndeclaredError {
  readonly code: "MAIN_CHECKOUT_UNDECLARED";
  readonly message: string;
  readonly mainCheckout: string;
}

/** The pre-setup copy is, holds, or sits inside, a git repository. */
export interface GitRepositoryRefusedError {
  readonly code: "GIT_REPOSITORY_REFUSED";
  readonly message: string;
  readonly path: string;
}

/** A process is running from inside the application bundle. */
export interface AppRunningError {
  readonly code: "APP_RUNNING";
  readonly message: string;
  readonly bundle: string;
  readonly pids: readonly number[];
}

/** Something already sits in the Trash under the bundle's name. */
export interface TrashCollisionError {
  readonly code: "TRASH_COLLISION";
  readonly message: string;
  readonly destination: string;
}

/** The bundle and the Trash are on different volumes, so a rename would not be a move. */
export interface TrashVolumeMismatchError {
  readonly code: "TRASH_VOLUME_MISMATCH";
  readonly message: string;
  readonly source: string;
}

/** A read of the machine failed. */
export interface ReadFailedError {
  readonly code: "READ_FAILED";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** Docker's own in-VM command failed or printed something the verb does not recognise. */
export interface DockerCommandFailedError {
  readonly code: "DOCKER_COMMAND_FAILED";
  readonly message: string;
  readonly argv: readonly string[];
  readonly cause: unknown;
}

/** A `docker` argv that is not one of the registry's fixed commands. */
export interface DockerArgvRefusedError {
  readonly code: "DOCKER_ARGV_REFUSED";
  readonly message: string;
  readonly argv: readonly string[];
}

/** A file the verb would measure a saving on has another hard link, so its blocks are not its own to count. */
export interface HardlinkedFileError {
  readonly code: "HARDLINKED_FILE";
  readonly message: string;
  readonly path: string;
}

/** What an act is about to touch no longer matches what the plan read. */
export interface PlanChangedError {
  readonly code: "PLAN_CHANGED";
  readonly message: string;
  readonly path: string;
}

/** The act itself failed. */
export interface ApplyFailedError {
  readonly code: "APPLY_FAILED";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** Every way `machine free-disk` can fail. */
export type FreeDiskError =
  | UnsupportedTargetError
  | ProtectedTargetError
  | BundleNameInvalidError
  | BundleRulingInvalidError
  | BundleProtectedError
  | BundleNotApprovedError
  | PathOutsideExpectedRootError
  | SymlinkRefusedError
  | WrongKindError
  | MainCheckoutUnprovenError
  | MainCheckoutUndeclaredError
  | GitRepositoryRefusedError
  | AppRunningError
  | TrashCollisionError
  | TrashVolumeMismatchError
  | ReadFailedError
  | DockerCommandFailedError
  | DockerArgvRefusedError
  | HardlinkedFileError
  | PlanChangedError
  | ApplyFailedError;

/**
 * The message a thrown cause carries, or a plain statement that it carried none.
 *
 * @returns the cause's own message, or a fixed sentence
 */
function causeMessage({ cause }: { cause: unknown }): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return "no message was carried";
}

/** The factory every `machine free-disk` failure is built with. */
export const FreeDiskErrors = {
  appRunning: ({ bundle, pids }: { bundle: string; pids: readonly number[] }): AppRunningError => ({
    bundle,
    code: "APP_RUNNING",
    message: `${bundle} is running (pid ${pids.join(", ")}) — quit it, then run this again`,
    pids,
  }),
  applyFailed: ({ path, cause }: { path: string; cause: unknown }): ApplyFailedError => ({
    cause,
    code: "APPLY_FAILED",
    message: `could not act on ${path}: ${causeMessage({ cause })}`,
    path,
  }),
  bundleNameInvalid: ({ named }: { named: string }): BundleNameInvalidError => ({
    code: "BUNDLE_NAME_INVALID",
    message: `--bundle takes an application's name, never a path: ${JSON.stringify(named)}`,
    named,
  }),
  bundleNotApproved: ({
    bundle,
    approved,
  }: {
    bundle: string;
    approved: readonly string[];
  }): BundleNotApprovedError => ({
    bundle,
    code: "BUNDLE_NOT_APPROVED",
    message: `${bundle} is not an application the owner ruled removable; the ruled ones: ${approved.length === 0 ? "none" : approved.join(", ")}`,
  }),
  bundleProtected: ({ bundle }: { bundle: string }): BundleProtectedError => ({
    bundle,
    code: "BUNDLE_PROTECTED",
    message: `${bundle} stays: the owner ruled it kept`,
  }),
  bundleRulingInvalid: ({ path, why }: { path: string; why: string }): BundleRulingInvalidError => ({
    code: "BUNDLE_RULING_INVALID",
    message: `${path} is not a bundle ruling (${why}); nothing was read as approved`,
    path,
  }),
  dockerArgvRefused: ({ argv }: { argv: readonly string[] }): DockerArgvRefusedError => ({
    argv,
    code: "DOCKER_ARGV_REFUSED",
    message: `docker ${argv.join(" ")} is not one of the fixed commands this verb runs, so it was not run`,
  }),
  dockerCommandFailed: ({ argv, cause }: { argv: readonly string[]; cause: unknown }): DockerCommandFailedError => ({
    argv,
    cause,
    code: "DOCKER_COMMAND_FAILED",
    message: `docker ${argv.join(" ")} failed: ${causeMessage({ cause })}`,
  }),
  gitRepositoryRefused: ({ path }: { path: string }): GitRepositoryRefusedError => ({
    code: "GIT_REPOSITORY_REFUSED",
    message: `${path} is, holds or sits inside a git repository, so it is not the pre-setup copy the owner ruled deletable`,
    path,
  }),
  hardlinkedFile: ({ path }: { path: string }): HardlinkedFileError => ({
    code: "HARDLINKED_FILE",
    message: `${path} has another hard link, so what trimming it frees cannot be counted as its own; nothing was planned`,
    path,
  }),
  mainCheckoutUndeclared: ({ mainCheckout }: { mainCheckout: string }): MainCheckoutUndeclaredError => ({
    code: "MAIN_CHECKOUT_UNDECLARED",
    mainCheckout,
    message: `${mainCheckout} is not a main checkout profile.json declares, so no copy beside it is the one ruled deletable`,
  }),
  mainCheckoutUnproven: (): MainCheckoutUnprovenError => ({
    code: "MAIN_CHECKOUT_UNPROVEN",
    message: "the main checkout could not be resolved from this directory, so the pre-setup copy cannot be derived",
  }),
  pathOutsideExpectedRoot: ({ path, realPath }: { path: string; realPath: string }): PathOutsideExpectedRootError => ({
    code: "PATH_OUTSIDE_EXPECTED_ROOT",
    message: `${path} resolves to ${realPath}, not to itself`,
    path,
    realPath,
  }),
  planChanged: ({ path, what }: { path: string; what: string }): PlanChangedError => ({
    code: "PLAN_CHANGED",
    message: `${path} changed since the plan read it (${what}); nothing further was touched`,
    path,
  }),
  protectedTarget: ({ named, why }: { named: string; why: string }): ProtectedTargetError => ({
    code: "PROTECTED_TARGET",
    message: `${named} stays: ${why}`,
    named,
  }),
  readFailed: ({ path, cause }: { path: string; cause: unknown }): ReadFailedError => ({
    cause,
    code: "READ_FAILED",
    message: `could not read ${path}: ${causeMessage({ cause })}`,
    path,
  }),
  symlinkRefused: ({ path }: { path: string }): SymlinkRefusedError => ({
    code: "SYMLINK_REFUSED",
    message: `${path} is a symbolic link; the verb acts only on the real path the registry names`,
    path,
  }),
  trashCollision: ({ destination }: { destination: string }): TrashCollisionError => ({
    code: "TRASH_COLLISION",
    destination,
    message: `${destination} already exists; empty or rename it first, the verb never overwrites the Trash`,
  }),
  trashVolumeMismatch: ({ source }: { source: string }): TrashVolumeMismatchError => ({
    code: "TRASH_VOLUME_MISMATCH",
    message: `${source} is on a different volume from the Trash, so moving it would be a copy and a delete`,
    source,
  }),
  unsupportedTarget: ({ named, targets }: { named: string; targets: readonly string[] }): UnsupportedTargetError => ({
    code: "UNSUPPORTED_TARGET",
    message: `${JSON.stringify(named)} is not a free-disk target; the targets: ${targets.join(", ")}`,
    named,
  }),
  wrongKind: ({ path, expected }: { path: string; expected: "directory" | "regular file" }): WrongKindError => ({
    code: "WRONG_KIND",
    expected,
    message: `${path} is not a ${expected}`,
    path,
  }),
} as const;
