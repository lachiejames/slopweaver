/**
 * The typed failures of the Inngest atlas — learning the dashboard's environment before a walk
 * (`browserWalk.ts`), reading the dashboard's own route table (`dashboardRoutes.ts`), compiling the public
 * REST catalogue (`restCatalogue.ts`), and the two HTTP transports underneath them (`transport.ts`).
 *
 * One union for the directory per `.claude/rules/error-handling.md`: its failures form no second cluster
 * worth a file. A variant carrying `reasons` keeps one line per problem, and {@link inngestAtlasErrorLines}
 * is how a caller prints them without re-composing the joined `message`.
 *
 * No variant carries a cookie, a relay token or an environment slug: the one transport message quoted is
 * the origin-only probe's, and every `url` is a pinned public address or one the caller built from one.
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
 * Every way reading Inngest's dashboard, its route table, its REST catalogue or an address can fail.
 *
 * @internal
 */
export type InngestAtlasError =
  | Plain<"DASHBOARD_UNREACHABLE">
  | Listed<"SIGNED_OUT">
  | (Listed<"ENTRY_UNDECLARED"> & { readonly url: string })
  | Listed<"ROUTES_UNREADABLE">
  | (Listed<"CATALOGUE_EMPTY"> & { readonly url: string })
  | (Plain<"DOCUMENT_REFUSED"> & { readonly url: string; readonly status: number })
  | (Plain<"DOCUMENT_UNFETCHED"> & { readonly url: string })
  | (Plain<"PROBE_FAILED"> & { readonly url: string });

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const InngestAtlasErrors = {
  catalogueEmpty: ({ url }: { url: string }): InngestAtlasError => ({
    ...listed({
      code: "CATALOGUE_EMPTY",
      reasons: [
        `${url} was read and declared no operation this compiler could recognise`,
        "an operation is a link whose reference path is /v1/<group>/<OperationId> or /v2/<group>/<OperationId>",
      ],
    }),
    url,
  }),
  dashboardUnreachable: ({ detail }: { detail: string }): InngestAtlasError => ({
    code: "DASHBOARD_UNREACHABLE",
    message: `could not reach the Inngest dashboard to learn its default environment: ${detail}`,
  }),
  documentRefused: ({ url, status }: { url: string; status: number }): InngestAtlasError => ({
    code: "DOCUMENT_REFUSED",
    message: `${url} answered HTTP ${String(status)}`,
    status,
    url,
  }),
  documentUnfetched: ({ url, cause }: { url: string; cause: unknown }): InngestAtlasError => ({
    code: "DOCUMENT_UNFETCHED",
    message: `${url} could not be fetched: ${errorMessage({ error: cause })}`,
    url,
  }),
  entryUndeclared: ({ url }: { url: string }): InngestAtlasError => ({
    ...listed({
      code: "ENTRY_UNDECLARED",
      reasons: [
        `${url} preloads no /assets/index-*.js entry, so the route table cannot be read`,
        "the dashboard's build layout has changed — re-read the page's modulepreload links before editing this",
      ],
    }),
    url,
  }),
  probeFailed: ({ url, cause }: { url: string; cause: unknown }): InngestAtlasError => ({
    code: "PROBE_FAILED",
    message: `${url} could not be probed: ${errorMessage({ error: cause })}`,
    url,
  }),
  routesUnreadable: (): InngestAtlasError =>
    listed({
      code: "ROUTES_UNREADABLE",
      reasons: [
        "the dashboard's entry bundle declares no route this compiler could read",
        "a route is `X.update({id:…,path:…,getParentRoute:()=>PARENT})` — the application's build has changed shape",
      ],
    }),
  signedOut: (): InngestAtlasError =>
    listed({
      code: "SIGNED_OUT",
      reasons: [
        "the Inngest dashboard sent this browser to its sign-in page, so no page could be walked",
        "sign in to Inngest in your own Chrome and run the walk again",
      ],
    }),
} as const;

/**
 * The lines one failure prints, one log record each, exactly as the atlas returned them before it had a
 * type: a list-carrying failure as its list, and every other failure as its one message.
 *
 * @param error the Inngest failure to render
 * @returns the lines, in order
 */
export function inngestAtlasErrorLines({ error }: { error: InngestAtlasError }): readonly string[] {
  if (
    error.code === "SIGNED_OUT" ||
    error.code === "ENTRY_UNDECLARED" ||
    error.code === "ROUTES_UNREADABLE" ||
    error.code === "CATALOGUE_EMPTY"
  ) {
    return error.reasons;
  }
  return [error.message];
}
