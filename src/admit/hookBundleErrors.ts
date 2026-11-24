/**
 * Every way a `PreToolUse` bundle generation cannot be built, published or vouched for by its manifest. One union
 * for this one domain, per `.claude/rules/error-handling.md`. None of these is a verdict on a tool call: each one
 * means only that no generation runs, and the shim runs the live TypeScript instead (`scripts/pretooluse.sh`).
 */

/** The esbuild metafile a build wrote is not the shape esbuild writes. */
export interface HookBundleMetafileMalformedError {
  readonly code: "HOOK_BUNDLE_METAFILE_MALFORMED";
  readonly message: string;
}

/** The build read no input from the source root, so a manifest would vouch for nothing. */
export interface HookBundleNoInputsError {
  readonly code: "HOOK_BUNDLE_NO_INPUTS";
  readonly message: string;
}

/** The build stamped none of its own files, so a truncated or rewritten output could still answer. */
export interface HookBundleNoOutputsError {
  readonly code: "HOOK_BUNDLE_NO_OUTPUTS";
  readonly message: string;
}

/** An input sits outside the source root, where a root-relative stamp cannot name it. */
export interface HookBundleInputOutsideRootError {
  readonly code: "HOOK_BUNDLE_INPUT_OUTSIDE_ROOT";
  readonly message: string;
  readonly path: string;
}

/** An input changed after the build began, so the build may hold bytes its stamps do not describe. */
export interface HookBundleInputsUnstableError {
  readonly code: "HOOK_BUNDLE_INPUTS_UNSTABLE";
  readonly message: string;
  readonly path: string;
}

/** A manifest on disk is not the shape this version writes. */
export interface HookBundleManifestMalformedError {
  readonly code: "HOOK_BUNDLE_MANIFEST_MALFORMED";
  readonly message: string;
}

/** esbuild refused the build: a missing import, a syntax error, or esbuild itself not loading. */
export interface HookBundleBuildFailedError {
  readonly code: "HOOK_BUNDLE_BUILD_FAILED";
  readonly message: string;
}

/** A file the build needs to stamp, write or rename could not be: an unwritable root, a vanished input. */
export interface HookBundleWriteFailedError {
  readonly code: "HOOK_BUNDLE_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** Every reason a hook bundle generation cannot be built, written or read. */
export type HookBundleError =
  | HookBundleMetafileMalformedError
  | HookBundleNoInputsError
  | HookBundleNoOutputsError
  | HookBundleInputOutsideRootError
  | HookBundleInputsUnstableError
  | HookBundleManifestMalformedError
  | HookBundleBuildFailedError
  | HookBundleWriteFailedError;

/** Constructors for {@link HookBundleError}. */
export const HookBundleErrors = {
  buildFailed: ({ cause }: { cause: unknown }): HookBundleBuildFailedError => ({
    code: "HOOK_BUNDLE_BUILD_FAILED",
    message: `esbuild could not build the hook bundle: ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
  inputOutsideRoot: ({ path }: { path: string }): HookBundleInputOutsideRootError => ({
    code: "HOOK_BUNDLE_INPUT_OUTSIDE_ROOT",
    message: `bundle input ${path} is not a path inside the source root`,
    path,
  }),
  inputsUnstable: ({ path }: { path: string }): HookBundleInputsUnstableError => ({
    code: "HOOK_BUNDLE_INPUTS_UNSTABLE",
    message: `bundle input ${path} changed after the build began, so the build is not published`,
    path,
  }),
  manifestMalformed: ({ detail }: { detail: string }): HookBundleManifestMalformedError => ({
    code: "HOOK_BUNDLE_MANIFEST_MALFORMED",
    message: `hook bundle manifest is malformed: ${detail}`,
  }),
  metafileMalformed: ({ detail }: { detail: string }): HookBundleMetafileMalformedError => ({
    code: "HOOK_BUNDLE_METAFILE_MALFORMED",
    message: `esbuild metafile is malformed: ${detail}`,
  }),
  noInputs: (): HookBundleNoInputsError => ({
    code: "HOOK_BUNDLE_NO_INPUTS",
    message: "the build read no input from the source root",
  }),
  noOutputs: (): HookBundleNoOutputsError => ({
    code: "HOOK_BUNDLE_NO_OUTPUTS",
    message: "the build stamped none of its own files, so nothing proves the generation is the one it wrote",
  }),
  writeFailed: ({ path, cause }: { path: string; cause: unknown }): HookBundleWriteFailedError => ({
    code: "HOOK_BUNDLE_WRITE_FAILED",
    message: `hook bundle could not touch ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
} as const;
