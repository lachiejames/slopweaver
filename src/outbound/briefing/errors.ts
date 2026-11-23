/**
 * The failure kinds the publish freeze (`./freezeStore.ts`) can produce, as typed discriminated unions scoped
 * to this directory — no shared base type with any other domain (`.claude/rules/error-handling.md`).
 *
 * Only keying and writing fail here, the write being the store's (`../../store/publishedPages/write.ts`): a freeze is
 * READ from the store too, whose own union
 * (`../../store/publishedPages/readErrors.ts`) keeps a page never frozen apart from one that could not be read.
 */
import { hatchFor } from "../../hatch/lookup.js";
import { hatchRefusal } from "../../hatch/render.js";

/** A `file:` address that is not a local page's, so it has no slug to key on. */
export interface FreezeFileAddressNotAPageError {
  readonly code: "FILE_ADDRESS_NOT_A_PAGE";
  readonly message: string;
  readonly artifact: string;
}

/** An address or id whose last segment is not a name the store can use as a directory. */
export interface FreezeArtifactUnnameableError {
  readonly code: "ARTIFACT_UNNAMEABLE";
  readonly message: string;
  readonly artifact: string;
}

/** A freeze that did not say it was opening a history, for a key the store holds no version of. */
export interface FreezeNewHistoryRefusedError {
  readonly code: "NEW_HISTORY_REFUSED";
  readonly message: string;
  readonly key: string;
  /** What this invocation saw: the key it resolved to and the existing keys a hair away from it. */
  readonly detail: string;
}

/** Writing the freeze into the store failed, or committed and then could not be confirmed. */
export interface FreezeWriteFailedError {
  readonly code: "FREEZE_WRITE_FAILED";
  readonly message: string;
  readonly key: string;
  /** The store's own refusals, each the line it prints. */
  readonly lines: readonly string[];
}

/** Every way turning an address into a store key can fail. */
export type FreezeKeyError = FreezeFileAddressNotAPageError | FreezeArtifactUnnameableError;

/** Every way filing one publish's bytes can fail. */
export type FreezeWriteError = FreezeKeyError | FreezeNewHistoryRefusedError | FreezeWriteFailedError;

/** Construct each freeze failure the same way the real code does. */
export const FreezeStoreErrors = {
  artifactUnnameable: ({ artifact }: { artifact: string }): FreezeArtifactUnnameableError => ({
    artifact,
    code: "ARTIFACT_UNNAMEABLE",
    message:
      `"${artifact}" does not name an artifact this store can file: expected an artifact URL or an id of ` +
      "letters, digits, dot, dash or underscore.",
  }),
  fileAddressNotAPage: ({ artifact }: { artifact: string }): FreezeFileAddressNotAPageError => ({
    artifact,
    code: "FILE_ADDRESS_NOT_A_PAGE",
    message:
      `"${artifact}" is a file address that does not name a local page: this store files one at ` +
      "`<home>/pages/<slug>/index.html`, and keys it on the slug.",
  }),
  newHistoryRefused: ({ key, detail }: { key: string; detail: string }): FreezeNewHistoryRefusedError => ({
    code: "NEW_HISTORY_REFUSED",
    detail,
    key,
    message: hatchRefusal({ detail, hatch: hatchFor({ id: "freeze-opens-new-history" }) }),
  }),
  writeFailed: ({ key, lines }: { key: string; lines: readonly string[] }): FreezeWriteFailedError => ({
    code: "FREEZE_WRITE_FAILED",
    key,
    lines,
    message:
      `writing the freeze of ${key} into the store failed or could not be confirmed, so \`briefing corrections\` ` +
      `cannot diff against it yet. Re-run the same freeze to complete it: ${lines.join("; ")}`,
  }),
} as const;
