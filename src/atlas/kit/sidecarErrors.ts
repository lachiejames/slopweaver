/**
 * The typed failures the atlas kit's two sidecar files author — the live-read stamp beside a manifest, and
 * the single-file repair that rewrites a pre-`.jsonl` kind file into the current layout and restamps the
 * manifest that vouches for it.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to those two modules of `src/atlas/kit/`.
 * Both hand the union to their one CLI runner, which prints {@link atlasSidecarErrorLines} exactly as it
 * printed the `readonly string[]` this replaced.
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

/** A failure about one file, named by its path. */
interface AtPath<C extends string> extends Plain<C> {
  readonly path: string;
}

/** Every failure the live-read stamp and the single-file repair author. */
export type AtlasSidecarError =
  | Listed<"STAMP_UNREADABLE">
  | (AtPath<"STAMP_NOT_JSON"> & { readonly cause: unknown })
  | AtPath<"STAMP_NOT_RECORD">
  | (AtPath<"STAMP_SCHEMA_FOREIGN"> & { readonly found: unknown; readonly writes: number })
  | AtPath<"STAMP_FIELDS_MISSING">
  | (Plain<"STAMP_WRITE_FAILED"> & { readonly atlasDir: string; readonly cause: unknown })
  | Plain<"SINGLE_FILE_NOT_OBJECT">
  | Plain<"SINGLE_FILE_NO_ENTITIES">
  | (AtPath<"SINGLE_FILE_REFUSED"> & { readonly cause: AtlasSidecarError })
  | Plain<"MANIFEST_KINDS_MISSING">
  | (Plain<"MANIFEST_CELL_MISSING"> & { readonly kind: string })
  | AtPath<"SINGLE_FILE_VANISHED">
  | (AtPath<"SINGLE_FILE_NOT_ARCHIVED"> & { readonly singleFilePath: string; readonly cause: unknown })
  | AtPath<"MANIFEST_ABSENT">
  | AtPath<"MANIFEST_NOT_OBJECT">
  | (AtPath<"REPAIR_INPUT_NOT_JSON"> & { readonly cause: unknown })
  | Listed<"UPSTREAM_FAILED">;

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const AtlasSidecarErrors = {
  singleFileNoEntities: (): AtlasSidecarError => ({
    code: "SINGLE_FILE_NO_ENTITIES",
    message: "the legacy kind file has no `entities` array, so it is not a kind file this repair can split",
  }),
  singleFileNotArchived: ({
    cause,
    singleFilePath,
    path,
  }: {
    cause: unknown;
    singleFilePath: string;
    path: string;
  }): AtlasSidecarError => ({
    cause,
    code: "SINGLE_FILE_NOT_ARCHIVED",
    singleFilePath,
    // `String`, not `errorMessage`: this line has always printed the whole thrown value, `Error:` prefix included.
    message: `${path} was rewritten but ${singleFilePath} could not be archived: ${String(cause)}`,
    path,
  }),
  singleFileNotObject: (): AtlasSidecarError => ({
    code: "SINGLE_FILE_NOT_OBJECT",
    message: "the legacy kind file is not a JSON object, so it is not a kind file this repair can split",
  }),
  singleFileRefused: ({ cause, path }: { cause: AtlasSidecarError; path: string }): AtlasSidecarError => ({
    cause,
    code: "SINGLE_FILE_REFUSED",
    message: `${path}: ${cause.message}`,
    path,
  }),
  singleFileVanished: ({ path }: { path: string }): AtlasSidecarError => ({
    code: "SINGLE_FILE_VANISHED",
    message: `${path} disappeared while the repair was running — nothing further was written`,
    path,
  }),
  manifestAbsent: ({ path }: { path: string }): AtlasSidecarError => ({
    code: "MANIFEST_ABSENT",
    message: `${path} is absent, so the rewritten kind files have nothing vouching for them`,
    path,
  }),
  manifestCellMissing: ({ kind }: { kind: string }): AtlasSidecarError => ({
    code: "MANIFEST_CELL_MISSING",
    kind,
    message: `the manifest has no cell for ${kind}, so the repair cannot restamp it`,
  }),
  manifestKindsMissing: (): AtlasSidecarError => ({
    code: "MANIFEST_KINDS_MISSING",
    message: "the manifest has no `kinds` object, so the repair cannot restamp it",
  }),
  manifestNotObject: ({ path }: { path: string }): AtlasSidecarError => ({
    code: "MANIFEST_NOT_OBJECT",
    message: `${path} is not a JSON object`,
    path,
  }),
  repairInputNotJson: ({ cause, path }: { cause: unknown; path: string }): AtlasSidecarError => ({
    cause,
    code: "REPAIR_INPUT_NOT_JSON",
    message:
      `${path} is not valid JSON (${errorMessage({ error: cause })}) — the repair wrote nothing; restore that file, ` +
      "or move it aside and re-sync the platform to rebuild it",
    path,
  }),
  stampFieldsMissing: ({ path }: { path: string }): AtlasSidecarError => ({
    code: "STAMP_FIELDS_MISSING",
    message: `${path} is missing one of atIso, verb or scope`,
    path,
  }),
  stampNotJson: ({ cause, path }: { cause: unknown; path: string }): AtlasSidecarError => ({
    cause,
    code: "STAMP_NOT_JSON",
    message: `${path} is not valid JSON: ${errorMessage({ error: cause })}`,
    path,
  }),
  stampNotRecord: ({ path }: { path: string }): AtlasSidecarError => ({
    code: "STAMP_NOT_RECORD",
    message: `${path} is not a live-read stamp`,
    path,
  }),
  stampSchemaForeign: ({
    found,
    path,
    writes,
  }: {
    found: unknown;
    path: string;
    writes: number;
  }): AtlasSidecarError => ({
    code: "STAMP_SCHEMA_FOREIGN",
    found,
    message: `${path} declares schema version ${String(found)}, and this build writes ${String(writes)}`,
    path,
    writes,
  }),
  stampUnreadable: ({ reasons }: { reasons: readonly string[] }): AtlasSidecarError =>
    listed({ code: "STAMP_UNREADABLE", reasons }),
  stampWriteFailed: ({ atlasDir, cause }: { atlasDir: string; cause: unknown }): AtlasSidecarError => ({
    atlasDir,
    cause,
    code: "STAMP_WRITE_FAILED",
    message: `cannot write the live-read stamp for ${atlasDir}: ${errorMessage({ error: cause })}`,
  }),
  upstreamFailed: ({ reasons }: { reasons: readonly string[] }): AtlasSidecarError =>
    listed({ code: "UPSTREAM_FAILED", reasons }),
} as const;

/**
 * The lines an {@link AtlasSidecarError} prints, one per problem. A list-carrying variant gives each entry its
 * own line, as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display
 * reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function atlasSidecarErrorLines({ error }: { error: AtlasSidecarError }): readonly string[] {
  if (error.code === "STAMP_UNREADABLE" || error.code === "UPSTREAM_FAILED") {
    return error.reasons;
  }
  return [error.message];
}
