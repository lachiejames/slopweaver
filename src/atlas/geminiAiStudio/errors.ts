/**
 * The typed failures the Gemini AI Studio atlas authors — a discovery document that could not be fetched,
 * parsed or cached, one that is not this platform's own document, and one declaring a resource root this
 * build has no kind for.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to `src/atlas/geminiAiStudio/`. Every
 * failure here feeds a CLI that prints one line per element, so each is built here and mapped through
 * {@link geminiAiStudioAtlasErrorLines} where it is authored. The envelope refusal is the one to read twice:
 * it carries one line per schema issue after its own, and printing the joined `message` instead would fold
 * a variable-length list onto one line.
 *
 * Named `errors.ts` rather than `geminiAiStudio*.ts` on purpose — the layering test's family is that prefix,
 * and this file is outside it.
 *
 * Pure: values in, values out.
 */
import { errorMessage } from "#lib/errorMessage.js";

import { GEMINI_AI_STUDIO_API_ORIGIN } from "./specLock.js";

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure that is a list of same-shaped problems, one line each. */
interface Listed<C extends string> extends Plain<C> {
  readonly reasons: readonly string[];
}

/** A failure about one published version's discovery document. */
interface OfVersion<C extends string> extends Plain<C> {
  readonly version: string;
}

/** A list-carrying failure about one published version's discovery document. */
interface ListedOfVersion<C extends string> extends Listed<C> {
  readonly version: string;
}

/** Every failure the Gemini AI Studio atlas authors. */
export type GeminiAiStudioAtlasError =
  | (OfVersion<"DOCUMENT_NOT_JSON"> & { readonly cause: unknown })
  | ListedOfVersion<"ENVELOPE_MISMATCH">
  | (ListedOfVersion<"VERSION_MISMATCH"> & { readonly declared: string })
  | (ListedOfVersion<"ROOT_URL_MISMATCH"> & { readonly rootUrl: string })
  | OfVersion<"VERSION_UNCOMPILED">
  | (ListedOfVersion<"FETCH_REFUSED"> & { readonly status: number; readonly url: string })
  | (OfVersion<"FETCH_FAILED"> & { readonly cause: unknown })
  | (OfVersion<"CACHE_UNWRITABLE"> & { readonly path: string; readonly cause: unknown })
  | (ListedOfVersion<"ROOTS_UNKNOWN"> & { readonly unknownRoots: readonly string[] });

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const GeminiAiStudioAtlasErrors = {
  cacheUnwritable: ({
    cause,
    path,
    version,
  }: {
    cause: unknown;
    path: string;
    version: string;
  }): GeminiAiStudioAtlasError => ({
    cause,
    code: "CACHE_UNWRITABLE",
    message: `the Gemini ${version} discovery document could not be cached at ${path}: ${errorMessage({ error: cause })}`,
    path,
    version,
  }),
  documentNotJson: ({ cause, version }: { cause: unknown; version: string }): GeminiAiStudioAtlasError => ({
    cause,
    code: "DOCUMENT_NOT_JSON",
    message: `the Gemini ${version} discovery document is not parseable JSON: ${errorMessage({ error: cause })}`,
    version,
  }),
  envelopeMismatch: ({
    issues,
    version,
  }: {
    issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[];
    version: string;
  }): GeminiAiStudioAtlasError => ({
    version,
    ...listed({
      code: "ENVELOPE_MISMATCH",
      reasons: [
        `the Gemini ${version} discovery document does not match the envelope this atlas requires, so nothing was published`,
        ...issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      ],
    }),
  }),
  fetchFailed: ({ cause, version }: { cause: unknown; version: string }): GeminiAiStudioAtlasError => ({
    cause,
    code: "FETCH_FAILED",
    message: `fetching the Gemini ${version} discovery document failed: ${errorMessage({ error: cause })}`,
    version,
  }),
  fetchRefused: ({
    status,
    url,
    version,
  }: {
    status: number;
    url: string;
    version: string;
  }): GeminiAiStudioAtlasError => ({
    status,
    url,
    version,
    ...listed({
      code: "FETCH_REFUSED",
      reasons: [
        `fetching the Gemini ${version} discovery document returned HTTP ${String(status)}`,
        `the address is computed from a constant origin and is not configurable: ${url}`,
      ],
    }),
  }),
  rootsUnknown: ({
    unknownRoots,
    version,
  }: {
    unknownRoots: readonly string[];
    version: string;
  }): GeminiAiStudioAtlasError => ({
    unknownRoots,
    version,
    ...listed({
      code: "ROOTS_UNKNOWN",
      reasons: [
        `the Gemini ${version} discovery document declares ${String(unknownRoots.length)} resource root(s) this build does not: ${unknownRoots.join(", ")}`,
        "nothing was published — a new root is Google adding a product area, which is exactly the unknown unknown this atlas exists to surface. Add it to GEMINI_AI_STUDIO_KINDS and to atlasHome.ts, then run again",
      ],
    }),
  }),
  rootUrlMismatch: ({ rootUrl, version }: { rootUrl: string; version: string }): GeminiAiStudioAtlasError => ({
    rootUrl,
    version,
    ...listed({
      code: "ROOT_URL_MISMATCH",
      reasons: [
        `the Gemini ${version} discovery document declares rootUrl ${rootUrl}, not ${GEMINI_AI_STUDIO_API_ORIGIN}/`,
        "nothing was published — this atlas reads exactly one origin and refuses a document pointing anywhere else",
      ],
    }),
  }),
  versionMismatch: ({ declared, version }: { declared: string; version: string }): GeminiAiStudioAtlasError => ({
    declared,
    version,
    ...listed({
      code: "VERSION_MISMATCH",
      reasons: [
        `the document served for version ${version} declares itself version ${declared}`,
        "nothing was published — a version segment that answers a different document is a routing change, not a vendor update",
      ],
    }),
  }),
  versionUncompiled: ({ version }: { version: string }): GeminiAiStudioAtlasError => ({
    code: "VERSION_UNCOMPILED",
    message: `this build compiles no Gemini discovery document for version ${version}`,
    version,
  }),
} as const;

/**
 * The lines a {@link GeminiAiStudioAtlasError} prints, one per problem. A list-carrying variant gives each
 * entry its own line, as the `readonly string[]` it replaced did, rather than the joined `message` a
 * single-line display reads.
 *
 * @param error the failure to render, list-carrying or single-sentence
 * @returns one line per problem, in the order they were found
 */
export function geminiAiStudioAtlasErrorLines({ error }: { error: GeminiAiStudioAtlasError }): readonly string[] {
  if (
    error.code === "ENVELOPE_MISMATCH" ||
    error.code === "VERSION_MISMATCH" ||
    error.code === "ROOT_URL_MISMATCH" ||
    error.code === "FETCH_REFUSED" ||
    error.code === "ROOTS_UNKNOWN"
  ) {
    return error.reasons;
  }
  return [error.message];
}
