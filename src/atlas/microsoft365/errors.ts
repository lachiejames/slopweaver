/**
 * The typed failures of the Microsoft 365 atlas — reading the pinned Microsoft Graph specification
 * (`specRead.ts`), fetching and caching it (`specSource.ts`), and refusing a resource root this build has
 * no kind for (`sync.ts`).
 *
 * One union for the directory per `.claude/rules/error-handling.md`: its failures form no second cluster
 * worth a file. A variant carrying `reasons` keeps one line per problem, and
 * {@link microsoft365AtlasErrorLines} is how a caller prints them without re-composing the joined `message`.
 *
 * The specification is public and fetched with no credential, so no variant can carry one; the address a
 * refusal quotes is the pin's own commit-addressed URL.
 *
 * Pure: values in, values out.
 */
import { errorMessage } from "#lib/errorMessage.js";
import { MICROSOFT365_SPEC_PIN } from "./specLock.js";

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure that is a list of same-shaped problems, one line each. */
interface Listed<C extends string> extends Plain<C> {
  readonly reasons: readonly string[];
}

/**
 * Every way reading, fetching or checking the pinned Microsoft Graph specification can fail.
 *
 * @internal
 */
export type Microsoft365AtlasError =
  | Plain<"SPEC_UNPARSEABLE">
  | Plain<"SPEC_NOT_MAPPING">
  | Plain<"SPEC_WITHOUT_PATHS">
  | (Listed<"DIGEST_MISMATCH"> & { readonly got: string; readonly expected: string })
  | (Plain<"BYTE_LENGTH_MISMATCH"> & { readonly got: number; readonly expected: number })
  | (Listed<"FETCH_REFUSED"> & { readonly status: number })
  | Plain<"FETCH_FAILED">
  | (Plain<"CACHE_UNWRITABLE"> & { readonly path: string })
  | (Listed<"ROOTS_UNKNOWN"> & { readonly unknownRoots: readonly string[] });

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const Microsoft365AtlasErrors = {
  byteLengthMismatch: ({ got }: { got: number }): Microsoft365AtlasError => ({
    code: "BYTE_LENGTH_MISMATCH",
    expected: MICROSOFT365_SPEC_PIN.byteLength,
    got,
    message: `the pinned Microsoft Graph specification is ${String(got)} bytes, expected ${String(MICROSOFT365_SPEC_PIN.byteLength)}`,
  }),
  cacheUnwritable: ({ path, cause }: { path: string; cause: unknown }): Microsoft365AtlasError => ({
    code: "CACHE_UNWRITABLE",
    message: `the pinned Microsoft Graph specification could not be cached at ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  digestMismatch: ({ got }: { got: string }): Microsoft365AtlasError => ({
    ...listed({
      code: "DIGEST_MISMATCH",
      reasons: [
        `the pinned Microsoft Graph specification did not hash to its pin: got ${got}, expected ${MICROSOFT365_SPEC_PIN.sha256}`,
        `the pin addresses an immutable commit (${MICROSOFT365_SPEC_PIN.commit}), so a mismatch is a truncated or intercepted download rather than a vendor change — nothing was cached`,
      ],
    }),
    expected: MICROSOFT365_SPEC_PIN.sha256,
    got,
  }),
  fetchFailed: ({ cause }: { cause: unknown }): Microsoft365AtlasError => ({
    code: "FETCH_FAILED",
    message: `fetching the pinned Microsoft Graph specification failed: ${errorMessage({ error: cause })}`,
  }),
  fetchRefused: ({ status }: { status: number }): Microsoft365AtlasError => ({
    ...listed({
      code: "FETCH_REFUSED",
      reasons: [
        `fetching the pinned Microsoft Graph specification returned HTTP ${String(status)}`,
        `the address is fixed at ${MICROSOFT365_SPEC_PIN.url} and is not configurable`,
      ],
    }),
    status,
  }),
  rootsUnknown: ({ unknownRoots }: { unknownRoots: readonly string[] }): Microsoft365AtlasError => ({
    ...listed({
      code: "ROOTS_UNKNOWN",
      reasons: [
        `the pinned specification declares ${String(unknownRoots.length)} resource root(s) this build does not: ${unknownRoots.join(", ")}`,
        "nothing was published — a new root is Microsoft adding a workload, which is exactly the unknown unknown this atlas exists to surface. Add it to MICROSOFT365_KINDS and to stateHome.ts, then run again",
      ],
    }),
    unknownRoots,
  }),
  specNotMapping: (): Microsoft365AtlasError => ({
    code: "SPEC_NOT_MAPPING",
    message: "the pinned Microsoft Graph specification is not a YAML mapping",
  }),
  specUnparseable: ({ cause }: { cause: unknown }): Microsoft365AtlasError => ({
    code: "SPEC_UNPARSEABLE",
    message: `the pinned Microsoft Graph specification could not be parsed: ${errorMessage({ error: cause })}`,
  }),
  specWithoutPaths: (): Microsoft365AtlasError => ({
    code: "SPEC_WITHOUT_PATHS",
    message: "the pinned Microsoft Graph specification declares no `paths` section",
  }),
} as const;

/**
 * The lines one failure prints, one log record each, exactly as the atlas returned them before it had a
 * type: a list-carrying failure as its list, and every other failure as its one message.
 *
 * @param error the Microsoft Graph failure to render
 * @returns the lines, in order
 */
export function microsoft365AtlasErrorLines({ error }: { error: Microsoft365AtlasError }): readonly string[] {
  if (error.code === "DIGEST_MISMATCH" || error.code === "FETCH_REFUSED" || error.code === "ROOTS_UNKNOWN") {
    return error.reasons;
  }
  return [error.message];
}
