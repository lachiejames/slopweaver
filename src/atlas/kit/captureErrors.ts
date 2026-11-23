/**
 * The typed failures the atlas kit's capture half authors — a screenshot that did not land as captured, a walk
 * that visited nothing or did not cover its declared pages, and a pinned API document that could not be
 * fetched or declares no surface.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to the walk and spec modules of
 * `src/atlas/kit/`. The artifact writer, the walk guards and the spec readers keep their `readonly string[]`
 * contract for the platforms that implement or call them, so each maps once through
 * {@link atlasCaptureErrorLines} at its own export — one line per problem, as before.
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

/** A failure about one stored screenshot, named by the path it is addressed by. */
interface AtScreenshot<C extends string> extends Plain<C> {
  readonly relativePath: string;
}

/** Every failure the capture half of the atlas kit authors. */
export type AtlasCaptureError =
  | (AtScreenshot<"SCREENSHOT_NOT_READ_BACK"> & { readonly cause: unknown })
  | (AtScreenshot<"SCREENSHOT_SIZE_MISMATCH"> & { readonly onDisk: number; readonly captured: number })
  | (AtScreenshot<"SCREENSHOT_DIGEST_MISMATCH"> & { readonly stored: string; readonly expected: string })
  | Plain<"WALK_VISITED_NOTHING">
  | (Listed<"WALK_COVERAGE_MISMATCH"> & {
      readonly missing: number;
      readonly undeclared: number;
      readonly duplicated: number;
    })
  | (Plain<"SCREENSHOT_UNREADABLE"> & { readonly providerId: string; readonly cause: unknown })
  | Listed<"SCREENSHOT_WRITE_REFUSED">
  | (Plain<"OPENAPI_NOT_OBJECT"> & { readonly specId: string })
  | (Plain<"OPENAPI_NO_PATHS"> & { readonly specId: string })
  | (Plain<"PINNED_HTTP_STATUS"> & { readonly status: number });

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const AtlasCaptureErrors = {
  openApiNoPaths: ({ specId }: { specId: string }): AtlasCaptureError => ({
    code: "OPENAPI_NO_PATHS",
    message: `${specId} declares no \`paths\` object — refusing rather than reporting an empty surface`,
    specId,
  }),
  openApiNotObject: ({ specId }: { specId: string }): AtlasCaptureError => ({
    code: "OPENAPI_NOT_OBJECT",
    message: `${specId} is not a JSON object, so it declares no operations`,
    specId,
  }),
  pinnedHttpStatus: ({ status }: { status: number }): AtlasCaptureError => ({
    code: "PINNED_HTTP_STATUS",
    message: `HTTP ${String(status)}`,
    status,
  }),
  screenshotDigestMismatch: ({
    expected,
    relativePath,
    stored,
  }: {
    expected: string;
    relativePath: string;
    stored: string;
  }): AtlasCaptureError => ({
    code: "SCREENSHOT_DIGEST_MISMATCH",
    expected,
    message: `the screenshot at ${relativePath} hashes to ${stored}, not the ${expected} it is addressed by`,
    relativePath,
    stored,
  }),
  screenshotNotReadBack: ({ cause, relativePath }: { cause: unknown; relativePath: string }): AtlasCaptureError => ({
    cause,
    code: "SCREENSHOT_NOT_READ_BACK",
    message: `the screenshot was written to ${relativePath} but could not be read back: ${errorMessage({ error: cause })}`,
    relativePath,
  }),
  screenshotSizeMismatch: ({
    captured,
    onDisk,
    relativePath,
  }: {
    captured: number;
    onDisk: number;
    relativePath: string;
  }): AtlasCaptureError => ({
    captured,
    code: "SCREENSHOT_SIZE_MISMATCH",
    message: `the screenshot at ${relativePath} is ${String(onDisk)} bytes on disk against the ${String(captured)} that were captured`,
    onDisk,
    relativePath,
  }),
  screenshotUnreadable: ({ cause, providerId }: { cause: unknown; providerId: string }): AtlasCaptureError => ({
    cause,
    code: "SCREENSHOT_UNREADABLE",
    message: `could not read the screenshot for ${providerId}: ${errorMessage({ error: cause })}`,
    providerId,
  }),
  screenshotWriteRefused: ({ reasons }: { reasons: readonly string[] }): AtlasCaptureError =>
    listed({ code: "SCREENSHOT_WRITE_REFUSED", reasons }),
  walkCoverageMismatch: ({
    duplicated,
    missing,
    undeclared,
  }: {
    duplicated: number;
    missing: number;
    undeclared: number;
  }): AtlasCaptureError => ({
    duplicated,
    missing,
    undeclared,
    ...listed({
      code: "WALK_COVERAGE_MISMATCH",
      reasons: [
        `this walk does not cover the declared page list: ${String(missing)} declared page(s) absent, ` +
          `${String(undeclared)} row(s) for a page that is not declared, ` +
          `${String(duplicated)} duplicated row(s)`,
        "nothing was published — a publisher that graded this against its own array would report full coverage over whatever it was handed",
      ],
    }),
  }),
  walkVisitedNothing: (): AtlasCaptureError => ({
    code: "WALK_VISITED_NOTHING",
    message: "the walk visited no page at all, so there is nothing to publish",
  }),
} as const;

/**
 * The lines an {@link AtlasCaptureError} prints, one per problem. A list-carrying variant gives each entry its
 * own line, as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display
 * reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function atlasCaptureErrorLines({ error }: { error: AtlasCaptureError }): readonly string[] {
  if (error.code === "WALK_COVERAGE_MISMATCH" || error.code === "SCREENSHOT_WRITE_REFUSED") {
    return error.reasons;
  }
  return [error.message];
}
