/**
 * The typed failures the Xero atlas authors — a web client the walk could not reach or was signed out of,
 * and an installed `xero-node` whose files could not be resolved, read or listed, or that declared an empty
 * surface.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to `src/atlas/xero/`. The walk's root
 * probe answers the kit's `readonly string[]` seam and the SDK readers feed a CLI that prints one line per
 * element, so each failure is built here and mapped through {@link xeroAtlasErrorLines} where it is authored.
 *
 * No variant carries the organisation short code: the probe's settled URL never enters one, and a transport
 * failure rides as its own message only, which is the one the walk already quoted.
 *
 * Pure: values in, values out.
 */
import { errorMessage } from "#lib/errorMessage.js";

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure that is a list of same-shaped problems, one line each. */
interface Listed<C extends string> extends Plain<C> {
  readonly reasons: readonly string[];
}

/** A failure about the installed package, named by the package it read. */
interface OfPackage<C extends string> extends Plain<C> {
  readonly packageName: string;
}

/** Every failure the Xero atlas authors. */
export type XeroAtlasError =
  | (Plain<"WEB_CLIENT_UNREACHABLE"> & { readonly detail: string })
  | Listed<"SIGNED_OUT">
  | (Listed<"SDK_UNRESOLVED"> & { readonly packageName: string; readonly cause: unknown })
  | (OfPackage<"PACKAGE_JSON_UNREADABLE"> & { readonly cause: unknown })
  | OfPackage<"VERSION_UNDECLARED">
  | (Listed<"API_CLASSES_UNLISTED"> & {
      readonly packageName: string;
      readonly subpath: string;
      readonly cause: unknown;
    })
  | (OfPackage<"API_CLASS_UNREADABLE"> & { readonly file: string; readonly cause: unknown })
  | (Listed<"MODELS_UNLISTED"> & { readonly packageName: string; readonly subpath: string; readonly cause: unknown })
  | (Listed<"NO_OPERATIONS"> & { readonly packageName: string; readonly version: string; readonly moduleCount: number })
  | (Listed<"NO_MODEL_FIELDS"> & { readonly packageName: string; readonly version: string });

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const XeroAtlasErrors = {
  apiClassesUnlisted: ({
    cause,
    packageName,
    subpath,
  }: {
    cause: unknown;
    packageName: string;
    subpath: string;
  }): XeroAtlasError => ({
    cause,
    packageName,
    subpath,
    ...listed({
      code: "API_CLASSES_UNLISTED",
      reasons: [
        `could not list ${packageName}'s generated API classes at ${subpath}: ${errorMessage({ error: cause })}`,
        "the package's layout has moved; this atlas's API surface is read from those files and cannot be inferred",
      ],
    }),
  }),
  apiClassUnreadable: ({
    cause,
    file,
    packageName,
  }: {
    cause: unknown;
    file: string;
    packageName: string;
  }): XeroAtlasError => ({
    cause,
    code: "API_CLASS_UNREADABLE",
    file,
    message: `could not read ${packageName}'s ${file}: ${errorMessage({ error: cause })}`,
    packageName,
  }),
  modelsUnlisted: ({
    cause,
    packageName,
    subpath,
  }: {
    cause: unknown;
    packageName: string;
    subpath: string;
  }): XeroAtlasError => ({
    cause,
    packageName,
    subpath,
    ...listed({
      code: "MODELS_UNLISTED",
      reasons: [
        `could not list ${packageName}'s generated models at ${subpath}: ${errorMessage({ error: cause })}`,
        "the response-field half of this atlas's API surface is read from those files and cannot be inferred",
      ],
    }),
  }),
  noModelFields: ({ packageName, version }: { packageName: string; version: string }): XeroAtlasError => ({
    packageName,
    version,
    ...listed({
      code: "NO_MODEL_FIELDS",
      reasons: [
        `${packageName} ${version} declared no model fields, so no operation could say what it returns`,
        "refusing to publish a surface with no response fields — the same silent-parser failure, one layer down",
      ],
    }),
  }),
  noOperations: ({
    moduleCount,
    packageName,
    version,
  }: {
    moduleCount: number;
    packageName: string;
    version: string;
  }): XeroAtlasError => ({
    moduleCount,
    packageName,
    version,
    ...listed({
      code: "NO_OPERATIONS",
      reasons: [
        `${packageName} ${version} declared no operations across ${String(moduleCount)} API class(es)`,
        "refusing to publish an empty API surface — an atlas that reports zero operations reads identically to one whose parser broke",
      ],
    }),
  }),
  packageJsonUnreadable: ({ cause, packageName }: { cause: unknown; packageName: string }): XeroAtlasError => ({
    cause,
    code: "PACKAGE_JSON_UNREADABLE",
    message: `could not read ${packageName}'s package.json: ${errorMessage({ error: cause })}`,
    packageName,
  }),
  sdkUnresolved: ({ cause, packageName }: { cause: unknown; packageName: string }): XeroAtlasError => ({
    cause,
    packageName,
    ...listed({
      code: "SDK_UNRESOLVED",
      reasons: [
        `could not resolve ${packageName}: ${errorMessage({ error: cause })}`,
        "the API surface is read from the installed client, so this atlas cannot be synced without it — run `yarn install`",
      ],
    }),
  }),
  signedOut: (): XeroAtlasError =>
    listed({
      code: "SIGNED_OUT",
      reasons: [
        "the Xero web client sent this browser to its sign-in origin, so no page could be walked",
        "sign in to Xero in your own Chrome and run the walk again",
      ],
    }),
  versionUndeclared: ({ packageName }: { packageName: string }): XeroAtlasError => ({
    code: "VERSION_UNDECLARED",
    message: `${packageName}'s package.json declares no version, so a stored generation could not name one`,
    packageName,
  }),
  webClientUnreachable: ({ detail }: { detail: string }): XeroAtlasError => ({
    code: "WEB_CLIENT_UNREACHABLE",
    detail,
    message: `could not reach the Xero web client to learn its organisation root: ${detail}`,
  }),
} as const;

/**
 * The lines a {@link XeroAtlasError} prints, one per problem. A list-carrying variant gives each entry its own
 * line, as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display
 * reads.
 *
 * @param error the failure to render, list-carrying or single-sentence
 * @returns one line per problem, in the order they were found
 */
export function xeroAtlasErrorLines({ error }: { error: XeroAtlasError }): readonly string[] {
  if (
    error.code === "SIGNED_OUT" ||
    error.code === "SDK_UNRESOLVED" ||
    error.code === "API_CLASSES_UNLISTED" ||
    error.code === "MODELS_UNLISTED" ||
    error.code === "NO_OPERATIONS" ||
    error.code === "NO_MODEL_FIELDS"
  ) {
    return error.reasons;
  }
  return [error.message];
}
