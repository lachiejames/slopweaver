/**
 * The typed failures the Clerk atlas authors — a dashboard the walk could not reach or was signed out of, an
 * instance root that could not be remembered or a remembered one that cannot be trusted, a pinned document that could not be read, and a download that
 * was not the pinned document.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to `src/atlas/clerk/`. The walk's root
 * probe answers the kit's `readonly string[]` seam and every other failure here feeds a CLI that prints one
 * line per element, so each is built here and mapped through {@link clerkAtlasErrorLines} where it is
 * authored.
 *
 * No variant carries the resolved instance root: it names the organisation's own application and instance,
 * so {@link ClerkAtlasErrors.rootUnremembered} takes the cause and nothing else. The one root a variant does
 * carry is a string that FAILED the shape check, exactly as the refusal always quoted it.
 *
 * Pure: values in, values out.
 */
import { errorMessage } from "#lib/errorMessage.js";

import type { ClerkSpecDocument } from "./specLock.js";

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure that is a list of same-shaped problems, one line each. */
interface Listed<C extends string> extends Plain<C> {
  readonly reasons: readonly string[];
}

/** A failure about one pinned document, named by the document it concerns. */
interface OfDocument<C extends string> extends Plain<C> {
  readonly document: ClerkSpecDocument;
}

/** Every failure the Clerk atlas authors. */
export type ClerkAtlasError =
  | (Plain<"DASHBOARD_UNREACHABLE"> & { readonly detail: string })
  | Listed<"SIGN_IN_WALL">
  | (Plain<"APPLICATIONS_UNREACHABLE"> & { readonly detail: string })
  | (Plain<"ROOT_MALFORMED"> & { readonly root: string })
  | (Plain<"ROOT_UNREMEMBERED"> & { readonly cause: unknown })
  | (Plain<"CLERK_REMEMBERED_ROOT_UNREADABLE"> & { readonly detail: string; readonly path: string })
  | (OfDocument<"DOCUMENT_UNPARSEABLE"> & { readonly cause: unknown })
  | OfDocument<"DOCUMENT_NOT_MAPPING">
  | (Listed<"DIGEST_MISMATCH"> & {
      readonly document: ClerkSpecDocument;
      readonly got: string;
      readonly expected: string;
      readonly url: string;
    })
  | (OfDocument<"BYTE_LENGTH_MISMATCH"> & { readonly got: number; readonly expected: number })
  | (Listed<"FETCH_REFUSED"> & { readonly document: ClerkSpecDocument; readonly status: number; readonly url: string })
  | (OfDocument<"FETCH_FAILED"> & { readonly cause: unknown })
  | (OfDocument<"CACHE_UNWRITABLE"> & { readonly path: string; readonly cause: unknown });

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const ClerkAtlasErrors = {
  applicationsUnreachable: ({ detail }: { detail: string }): ClerkAtlasError => ({
    code: "APPLICATIONS_UNREACHABLE",
    detail,
    message: `the Clerk dashboard did not send the bare origin to an instance, and the application list could not be reached either: ${detail}`,
  }),
  byteLengthMismatch: ({
    byteLength,
    pin,
  }: {
    byteLength: number;
    pin: { readonly document: ClerkSpecDocument; readonly byteLength: number };
  }): ClerkAtlasError => ({
    code: "BYTE_LENGTH_MISMATCH",
    document: pin.document,
    expected: pin.byteLength,
    got: byteLength,
    message: `the pinned Clerk ${pin.document} document is ${String(byteLength)} bytes, expected ${String(pin.byteLength)}`,
  }),
  cacheUnwritable: ({
    cause,
    path,
    pin,
  }: {
    cause: unknown;
    path: string;
    pin: { readonly document: ClerkSpecDocument };
  }): ClerkAtlasError => ({
    cause,
    code: "CACHE_UNWRITABLE",
    document: pin.document,
    message: `the pinned Clerk ${pin.document} document could not be cached at ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  dashboardUnreachable: ({ detail }: { detail: string }): ClerkAtlasError => ({
    code: "DASHBOARD_UNREACHABLE",
    detail,
    message: `could not reach the Clerk dashboard to learn its instance root: ${detail}`,
  }),
  digestMismatch: ({
    got,
    pin,
  }: {
    got: string;
    pin: { readonly document: ClerkSpecDocument; readonly sha256: string; readonly url: string };
  }): ClerkAtlasError => ({
    document: pin.document,
    expected: pin.sha256,
    got,
    url: pin.url,
    ...listed({
      code: "DIGEST_MISMATCH",
      reasons: [
        `the pinned Clerk ${pin.document} document did not hash to its pin: got ${got}, expected ${pin.sha256}`,
        `the pin addresses an immutable commit (${pin.url}), so a mismatch is a truncated or intercepted download rather than a vendor change — nothing was cached`,
      ],
    }),
  }),
  documentNotMapping: ({ document }: { document: ClerkSpecDocument }): ClerkAtlasError => ({
    code: "DOCUMENT_NOT_MAPPING",
    document,
    message: `the pinned Clerk ${document} document is not a YAML mapping`,
  }),
  documentUnparseable: ({ cause, document }: { cause: unknown; document: ClerkSpecDocument }): ClerkAtlasError => ({
    cause,
    code: "DOCUMENT_UNPARSEABLE",
    document,
    message: `the pinned Clerk ${document} document could not be parsed: ${errorMessage({ error: cause })}`,
  }),
  fetchFailed: ({
    cause,
    pin,
  }: {
    cause: unknown;
    pin: { readonly document: ClerkSpecDocument };
  }): ClerkAtlasError => ({
    cause,
    code: "FETCH_FAILED",
    document: pin.document,
    message: `fetching the pinned Clerk ${pin.document} document failed: ${errorMessage({ error: cause })}`,
  }),
  fetchRefused: ({
    pin,
    status,
  }: {
    pin: { readonly document: ClerkSpecDocument; readonly url: string };
    status: number;
  }): ClerkAtlasError => ({
    document: pin.document,
    status,
    url: pin.url,
    ...listed({
      code: "FETCH_REFUSED",
      reasons: [
        `fetching the pinned Clerk ${pin.document} document returned HTTP ${String(status)}`,
        `the address is fixed at ${pin.url} and is not configurable`,
      ],
    }),
  }),
  rootMalformed: ({ root }: { root: string }): ClerkAtlasError => ({
    code: "ROOT_MALFORMED",
    message: `"${root}" is not a Clerk instance root — it must read /apps/<application>/instances/<instance>, exactly as the dashboard's own address does`,
    root,
  }),
  rememberedRootUnreadable: ({ detail, path }: { detail: string; path: string }): ClerkAtlasError => ({
    code: "CLERK_REMEMBERED_ROOT_UNREADABLE",
    detail,
    message: `the remembered Clerk instance root at ${path} is there but cannot be trusted (${detail}) — delete that file, or pass --root /apps/<application>/instances/<instance> to overwrite it`,
    path,
  }),
  rootUnremembered: ({ cause }: { cause: unknown }): ClerkAtlasError => ({
    cause,
    code: "ROOT_UNREMEMBERED",
    message: `the Clerk instance root could not be remembered: ${errorMessage({ error: cause })}`,
  }),
  signInWall: (): ClerkAtlasError =>
    listed({
      code: "SIGN_IN_WALL",
      reasons: [
        "the Clerk dashboard sent this browser to a sign-in wall, so no page could be walked",
        "sign in to the Clerk dashboard in your own Chrome and run the walk again",
      ],
    }),
} as const;

/**
 * The lines a {@link ClerkAtlasError} prints, one per problem. A list-carrying variant gives each entry its
 * own line, as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display
 * reads.
 *
 * @param error the failure to render, list-carrying or single-sentence
 * @returns one line per problem, in the order they were found
 */
export function clerkAtlasErrorLines({ error }: { error: ClerkAtlasError }): readonly string[] {
  if (error.code === "SIGN_IN_WALL" || error.code === "DIGEST_MISMATCH" || error.code === "FETCH_REFUSED") {
    return error.reasons;
  }
  return [error.message];
}
