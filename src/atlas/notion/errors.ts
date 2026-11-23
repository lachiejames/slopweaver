/**
 * The typed failures the Notion atlas authors — a web client the walk's workspace probe could not reach, an
 * installed `@notionhq/client` whose files could not be resolved, read or listed or that declared no
 * endpoints, and a `--tab` value outside the closed settings set.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to `src/atlas/notion/`. Every function that
 * authors one of these keeps its `readonly string[]` contract for the verbs that print one line per element,
 * so each failure is built here and turned into lines by {@link notionAtlasErrorLines} where it is raised.
 *
 * No variant carries a workspace slug, a cookie or a page URL: the probe asks for the bare origin, and its
 * transport failure rides as that failure's own message only.
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

/**
 * Every failure the Notion atlas authors.
 *
 * @internal
 */
export type NotionAtlasError =
  | (Plain<"WEB_CLIENT_UNREACHABLE"> & { readonly detail: string })
  | (Listed<"SDK_UNRESOLVED"> & { readonly packageName: string; readonly cause: unknown })
  | (Plain<"PACKAGE_JSON_UNREADABLE"> & { readonly packageName: string; readonly cause: unknown })
  | (Plain<"VERSION_UNDECLARED"> & { readonly packageName: string })
  | (Listed<"ENDPOINTS_UNLISTED"> & { readonly packageName: string; readonly subpath: string; readonly cause: unknown })
  | (Plain<"ENDPOINT_MODULE_UNREADABLE"> & {
      readonly packageName: string;
      readonly file: string;
      readonly cause: unknown;
    })
  | (Listed<"NO_ENDPOINTS"> & { readonly packageName: string; readonly version: string; readonly moduleCount: number })
  | (Plain<"TAB_UNKNOWN"> & { readonly id: string; readonly known: readonly string[] });

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const NotionAtlasErrors = {
  clientUnreachable: ({ detail }: { detail: string }): NotionAtlasError => ({
    code: "WEB_CLIENT_UNREACHABLE",
    detail,
    message: `could not reach the Notion web client to learn its workspace: ${detail}`,
  }),
  endpointsUnlisted: ({
    cause,
    packageName,
    subpath,
  }: {
    cause: unknown;
    packageName: string;
    subpath: string;
  }): NotionAtlasError => ({
    cause,
    packageName,
    subpath,
    ...listed({
      code: "ENDPOINTS_UNLISTED",
      reasons: [
        `could not list ${packageName}'s generated endpoint modules at ${subpath}: ${errorMessage({ error: cause })}`,
        "the package's layout has moved; this atlas's API surface is read from those files and cannot be inferred",
      ],
    }),
  }),
  moduleUnreadable: ({
    cause,
    file,
    packageName,
  }: {
    cause: unknown;
    file: string;
    packageName: string;
  }): NotionAtlasError => ({
    cause,
    code: "ENDPOINT_MODULE_UNREADABLE",
    file,
    message: `could not read ${packageName}'s ${file}: ${errorMessage({ error: cause })}`,
    packageName,
  }),
  noEndpoints: ({
    moduleCount,
    packageName,
    version,
  }: {
    moduleCount: number;
    packageName: string;
    version: string;
  }): NotionAtlasError => ({
    moduleCount,
    packageName,
    version,
    ...listed({
      code: "NO_ENDPOINTS",
      reasons: [
        `${packageName} ${version} declared no endpoints across ${String(moduleCount)} module(s)`,
        "refusing to publish an empty API surface — an atlas that reports zero endpoints reads identically to one whose parser broke",
      ],
    }),
  }),
  packageJsonUnreadable: ({ cause, packageName }: { cause: unknown; packageName: string }): NotionAtlasError => ({
    cause,
    code: "PACKAGE_JSON_UNREADABLE",
    message: `could not read ${packageName}'s package.json: ${errorMessage({ error: cause })}`,
    packageName,
  }),
  sdkUnresolved: ({ cause, packageName }: { cause: unknown; packageName: string }): NotionAtlasError => ({
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
  tabUnknown: ({ id, known }: { id: string; known: readonly string[] }): NotionAtlasError => ({
    code: "TAB_UNKNOWN",
    id,
    known,
    message: `--tab '${id}' is not a tab this build knows; the closed set is ${known.join(", ")}`,
  }),
  versionUndeclared: ({ packageName }: { packageName: string }): NotionAtlasError => ({
    code: "VERSION_UNDECLARED",
    message: `${packageName}'s package.json declares no version, so a stored generation could not name one`,
    packageName,
  }),
} as const;

/**
 * The lines a {@link NotionAtlasError} prints, one per problem. A list-carrying variant gives each entry its
 * own line, as the `readonly string[]` it replaced did, rather than the joined `message`.
 *
 * @param error the Notion failure to render, list-carrying or single-sentence
 * @returns one line per problem, in the order they were found
 */
export function notionAtlasErrorLines({ error }: { error: NotionAtlasError }): readonly string[] {
  if (error.code === "SDK_UNRESOLVED" || error.code === "ENDPOINTS_UNLISTED" || error.code === "NO_ENDPOINTS") {
    return error.reasons;
  }
  return [error.message];
}
