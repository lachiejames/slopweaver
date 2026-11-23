/**
 * The typed failures the generation store authors — a manifest or kind file that will not read, parse or
 * validate, and every refusal `reset` and `restore` raise while they move whole generations between the
 * live path and the `_superseded` archive.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to the store, reset and archive half of
 * `src/atlas/kit/`. `readManifest`, `readKindFile` and `resetAtlas` keep their `readonly string[]` contract for
 * the platforms that call them and map once through {@link atlasGenerationErrorLines}; the archive verbs hand
 * the union to their one CLI runner, which prints the same lines.
 *
 * Pure: values in, values out.
 */
import { errorMessage } from "../../lib/errorMessage.js";

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure that is a list of same-shaped problems, one line each. */
interface Listed<C extends string> extends Plain<C> {
  readonly reasons: readonly string[];
}

/** A step that threw, carrying what it threw. */
interface Thrown {
  readonly cause: unknown;
}

/** One schema issue as a Zod `safeParse` reports it. */
interface SchemaIssue {
  readonly path: readonly (string | number | symbol)[];
  readonly message: string;
}

/** An archive named by its id, with the schema version its manifest declares. */
type ArchiveVersion = { readonly archiveId: string; readonly archiveVersion: number };

/** Every failure the generation store, `reset` and `restore` author. */
export type AtlasGenerationError =
  | Listed<"SOURCE_UNREADABLE">
  | (Listed<"NOT_JSON"> & { readonly path: string })
  | (Listed<"SCHEMA_UNSATISFIED"> & { readonly path: string; readonly platform: string })
  | (Listed<"FOREIGN_SCHEMA_VERSION"> & { readonly path: string; readonly found: number; readonly writes: number })
  | (Listed<"KIND_MISFILED"> & { readonly path: string; readonly kind: string })
  | (Plain<"NO_CURRENT_GENERATION"> & { readonly platform: string; readonly directory: string })
  | (Plain<"RESET_ARCHIVE_EXISTS"> & { readonly archive: string })
  | (Listed<"RESET_CURRENT_NOT_ARCHIVED"> & Thrown)
  | (Plain<"RESTORE_STUMP_UNREMOVABLE"> & Thrown & { readonly archive: string; readonly directory: string })
  | (Plain<"RESTORE_RENAME_FAILED"> & Thrown & { readonly archive: string })
  | Listed<"RESET_PUBLISH_FAILED">
  | (Plain<"ARCHIVE_ROOT_UNLISTABLE"> & Thrown & { readonly path: string })
  | (Listed<"ARCHIVE_UNKNOWN"> & {
      readonly archiveId: string;
      readonly superseded: string;
      readonly known: readonly string[];
    })
  | (Listed<"RESTORE_CURRENT_NOT_ARCHIVED"> & Thrown)
  | (Listed<"ARCHIVE_MANIFEST_UNREADABLE"> & { readonly archiveId: string })
  | (Listed<"LIVE_VERSION_UNKNOWN"> & ArchiveVersion)
  | (Listed<"SCHEMA_VERSION_MISMATCH"> & ArchiveVersion & { readonly liveVersion: number })
  | (Listed<"ARCHIVE_SELF_DISAGREES"> & { readonly archiveId: string })
  | (Listed<"DISPLACED_ARCHIVE_EXISTS"> & { readonly displaced: string })
  | (Listed<"ARCHIVE_INSTALL_FAILED"> & Thrown & { readonly archiveId: string });

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const AtlasGenerationErrors = {
  archiveInstallFailed: ({
    archiveId,
    cause,
    rollback,
  }: {
    archiveId: string;
    cause: unknown;
    rollback: readonly string[];
  }): AtlasGenerationError => ({
    archiveId,
    cause,
    ...listed({
      code: "ARCHIVE_INSTALL_FAILED",
      reasons: [`could not install ${archiveId}: ${errorMessage({ error: cause })}`, ...rollback],
    }),
  }),
  archiveManifestUnreadable: ({ archiveId }: { archiveId: string }): AtlasGenerationError => ({
    archiveId,
    ...listed({
      code: "ARCHIVE_MANIFEST_UNREADABLE",
      reasons: [
        `archive ${archiveId} has no readable manifest, so what it holds cannot be established`,
        "nothing was moved — restore refuses rather than installing a generation it cannot read",
      ],
    }),
  }),
  archiveRootUnlistable: ({ cause, path }: { cause: unknown; path: string }): AtlasGenerationError => ({
    cause,
    code: "ARCHIVE_ROOT_UNLISTABLE",
    message: `cannot list ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  archiveSelfDisagrees: ({
    archiveId,
    disagreements,
  }: {
    archiveId: string;
    disagreements: readonly string[];
  }): AtlasGenerationError => ({
    archiveId,
    ...listed({
      code: "ARCHIVE_SELF_DISAGREES",
      reasons: [
        `archive ${archiveId} does not match its own manifest:`,
        ...disagreements,
        "nothing was moved — restore refuses rather than installing a generation that disagrees with itself",
      ],
    }),
  }),
  archiveUnknown: ({
    archiveId,
    known,
    superseded,
  }: {
    archiveId: string;
    known: readonly string[];
    superseded: string;
  }): AtlasGenerationError => {
    const held =
      known.length === 0
        ? "this atlas has archived no generation — nothing was moved"
        : `archives this atlas holds: ${known.join(", ")}`;
    return {
      archiveId,
      known,
      superseded,
      ...listed({ code: "ARCHIVE_UNKNOWN", reasons: [`no archive ${archiveId} under ${superseded}`, held] }),
    };
  },
  displacedArchiveExists: ({ displaced }: { displaced: string }): AtlasGenerationError => ({
    displaced,
    ...listed({
      code: "DISPLACED_ARCHIVE_EXISTS",
      reasons: [`an archive already exists at ${displaced} — refusing to overwrite it`, "nothing was moved"],
    }),
  }),
  foreignSchemaVersion: ({
    advice,
    found,
    path,
    writes,
  }: {
    advice: string;
    found: number;
    path: string;
    writes: number;
  }): AtlasGenerationError => ({
    found,
    path,
    writes,
    ...listed({
      code: "FOREIGN_SCHEMA_VERSION",
      reasons: [
        `${path} declares schema version ${String(found)}, and this build writes version ${String(writes)}`,
        advice,
      ],
    }),
  }),
  kindMisfiled: ({
    kind,
    misrouted,
    path,
  }: {
    kind: string;
    misrouted: readonly string[];
    path: string;
  }): AtlasGenerationError => ({
    kind,
    path,
    ...listed({
      code: "KIND_MISFILED",
      reasons: [
        `${path} does not agree with the kind it is filed under (${kind})`,
        ...misrouted.slice(0, 8).map((problem) => `  ${problem}`),
      ],
    }),
  }),
  liveVersionUnknown: ({ archiveId, archiveVersion }: ArchiveVersion): AtlasGenerationError => ({
    archiveId,
    archiveVersion,
    ...listed({
      code: "LIVE_VERSION_UNKNOWN",
      reasons: [
        `there is no readable live manifest at this atlas, so the schema version this build writes cannot be established`,
        `archive ${archiveId} declares schema version ${String(archiveVersion)}`,
        "nothing was moved — run the platform's own sync once so the store declares its version, then restore",
      ],
    }),
  }),
  noCurrentGeneration: ({ directory, platform }: { directory: string; platform: string }): AtlasGenerationError => ({
    code: "NO_CURRENT_GENERATION",
    directory,
    message: `no current ${platform} atlas at ${directory} — nothing to reset`,
    platform,
  }),
  notJson: ({ path }: { path: string }): AtlasGenerationError => ({
    path,
    ...listed({
      code: "NOT_JSON",
      reasons: [`${path} is not valid JSON`, "refusing rather than treating a corrupt atlas as an empty one"],
    }),
  }),
  resetArchiveExists: ({ archive }: { archive: string }): AtlasGenerationError => ({
    archive,
    code: "RESET_ARCHIVE_EXISTS",
    message: `an archive already exists at ${archive} — refusing to overwrite it`,
  }),
  resetCurrentNotArchived: ({ cause }: { cause: unknown }): AtlasGenerationError => ({
    cause,
    ...listed({
      code: "RESET_CURRENT_NOT_ARCHIVED",
      reasons: [`could not archive the current generation: ${errorMessage({ error: cause })}`, "nothing was reset"],
    }),
  }),
  resetPublishFailed: ({
    published,
    restoreFailure,
  }: {
    published: readonly string[];
    restoreFailure: AtlasGenerationError | null;
  }): AtlasGenerationError => {
    const restored =
      restoreFailure === null ? "the archived generation was restored; nothing was reset" : restoreFailure.message;
    return listed({ code: "RESET_PUBLISH_FAILED", reasons: [...published, restored] });
  },
  restoreCurrentNotArchived: ({ cause }: { cause: unknown }): AtlasGenerationError => ({
    cause,
    ...listed({
      code: "RESTORE_CURRENT_NOT_ARCHIVED",
      reasons: [`could not archive the current generation: ${errorMessage({ error: cause })}`, "nothing was moved"],
    }),
  }),
  restoreRenameFailed: ({ archive, cause }: { archive: string; cause: unknown }): AtlasGenerationError => ({
    archive,
    cause,
    code: "RESTORE_RENAME_FAILED",
    message: `the archived generation is at ${archive} and could not be restored: ${errorMessage({ error: cause })}`,
  }),
  restoreStumpUnremovable: ({
    archive,
    cause,
    directory,
  }: {
    archive: string;
    cause: unknown;
    directory: string;
  }): AtlasGenerationError => ({
    archive,
    cause,
    code: "RESTORE_STUMP_UNREMOVABLE",
    directory,
    message:
      `the archived generation is at ${archive} and could not be restored: the partial generation at ` +
      `${directory} could not be removed: ${errorMessage({ error: cause })}`,
  }),
  schemaUnsatisfied: ({
    issues,
    path,
    platform,
  }: {
    issues: readonly SchemaIssue[];
    path: string;
    platform: string;
  }): AtlasGenerationError => ({
    path,
    platform,
    ...listed({
      code: "SCHEMA_UNSATISFIED",
      reasons: [
        `${path} does not satisfy the ${platform} atlas schema`,
        ...issues.slice(0, 8).map((issue) => `  ${issue.path.map(String).join(".")}: ${issue.message}`),
      ],
    }),
  }),
  schemaVersionMismatch: ({
    archiveId,
    archiveVersion,
    liveVersion,
  }: ArchiveVersion & { liveVersion: number }): AtlasGenerationError => ({
    archiveId,
    archiveVersion,
    liveVersion,
    ...listed({
      code: "SCHEMA_VERSION_MISMATCH",
      reasons: [
        `archive ${archiveId} declares schema version ${String(archiveVersion)}; this build writes version ${String(liveVersion)}`,
        "nothing was moved — use a Slopweaver build that writes the archive's version to restore it",
      ],
    }),
  }),
  sourceUnreadable: ({ reasons }: { reasons: readonly string[] }): AtlasGenerationError =>
    listed({ code: "SOURCE_UNREADABLE", reasons }),
} as const;

/**
 * The lines an {@link AtlasGenerationError} prints, one per problem. A list-carrying variant gives each entry
 * its own line, as the `readonly string[]` it replaced did, rather than the joined `message` a single-line
 * display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function atlasGenerationErrorLines({ error }: { error: AtlasGenerationError }): readonly string[] {
  if (
    error.code === "NO_CURRENT_GENERATION" ||
    error.code === "RESET_ARCHIVE_EXISTS" ||
    error.code === "RESTORE_STUMP_UNREMOVABLE" ||
    error.code === "RESTORE_RENAME_FAILED" ||
    error.code === "ARCHIVE_ROOT_UNLISTABLE"
  ) {
    return [error.message];
  }
  return error.reasons;
}
