/**
 * The Linear atlas's own failure vocabulary.
 *
 * A discriminated union scoped to this one module, per `.claude/rules/error-handling.md`: the failure kinds
 * here are genuinely distinct and a caller branches on them — a schema read that the API refused is a
 * different thing from a browser relay that never attached, and only one of them is worth retrying. No base
 * type is shared with any other domain, deliberately.
 *
 * The publish-side refusals are members too — a generation crossing workspaces, a run where neither surface
 * read anything, a generation holding a value this atlas may never hold, a walk with no page planned. Their
 * callers keep a `readonly string[]` contract, so {@link linearAtlasErrorLines} prints them one line per
 * problem. No field of its own carries a workspace id or a held value; the workspace-crossed lines print both
 * ids, exactly as they always have.
 */

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure that is a list of same-shaped problems, one line each. */
interface Listed<C extends string> extends Plain<C> {
  readonly reasons: readonly string[];
}

/** The GraphQL schema could not be read at all. */
export interface SchemaUnreadableError {
  readonly code: "SCHEMA_UNREADABLE";
  readonly message: string;
  readonly cause?: unknown;
}

/** The schema came back but did not have the shape an introspection response must have. */
export interface SchemaMalformedError {
  readonly code: "SCHEMA_MALFORMED";
  readonly message: string;
  /** The first few validation problems, so a reader sees WHICH part disagreed. */
  readonly issues: readonly string[];
}

/** A configuration read named by the closed inventory failed. */
export interface SettingsReadError {
  readonly code: "SETTINGS_READ_FAILED";
  readonly message: string;
  /** Which inventory row was being read. */
  readonly surface: string;
  readonly cause?: unknown;
}

/** The browser surface could not be filled, because the transport never reached the owner's Chrome. */
export interface BrowserUnavailableError {
  readonly code: "BROWSER_UNAVAILABLE";
  readonly message: string;
}

/** No credential is configured, so nothing can be read. */
export interface NotConfiguredError {
  readonly code: "NOT_CONFIGURED";
  readonly message: string;
  /** The one command that fixes it. */
  readonly unblockedBy: string;
}

/** Every way the Linear atlas can fail. */
export type LinearAtlasError =
  | SchemaUnreadableError
  | SchemaMalformedError
  | SettingsReadError
  | BrowserUnavailableError
  | NotConfiguredError
  | Listed<"WORKSPACE_CROSSED">
  | (Listed<"NOTHING_READ"> & { readonly because: string })
  | (Listed<"SENSITIVE_VALUES_HELD"> & { readonly hits: readonly { readonly path: string; readonly reason: string }[] })
  | Plain<"PAGES_UNPLANNED">;

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** Typed failures for the Linear atlas, constructed only through here. */
export const LinearAtlasErrors = {
  browserUnavailable: ({ reason }: { reason: string }): BrowserUnavailableError => ({
    code: "BROWSER_UNAVAILABLE",
    message: `the browser surface could not be filled: ${reason}`,
  }),
  nothingRead: ({ because }: { because: string }): LinearAtlasError => ({
    because,
    ...listed({
      code: "NOTHING_READ",
      reasons: ["neither surface produced a reading, so there is nothing to publish", because],
    }),
  }),
  notConfigured: (): NotConfiguredError => ({
    code: "NOT_CONFIGURED",
    message: "no Linear API key is configured, so neither surface can be read",
    unblockedBy: "slopweaver secrets set linear-token",
  }),
  pagesUnplanned: (): LinearAtlasError => ({
    code: "PAGES_UNPLANNED",
    message: "no settings page was planned, so a walk would report full coverage over nothing",
  }),
  schemaMalformed: ({ issues }: { issues: readonly string[] }): SchemaMalformedError => ({
    code: "SCHEMA_MALFORMED",
    issues,
    message: `the GraphQL introspection response did not have the shape an introspection response must have (${String(issues.length)} problem(s))`,
  }),
  schemaUnreadable: ({ cause }: { cause: unknown }): SchemaUnreadableError => ({
    cause,
    code: "SCHEMA_UNREADABLE",
    message: cause instanceof Error ? cause.message : "the Linear GraphQL schema could not be read",
  }),
  sensitiveValuesHeld: ({
    hits,
  }: {
    hits: readonly { readonly path: string; readonly reason: string }[];
  }): LinearAtlasError => ({
    hits,
    ...listed({
      code: "SENSITIVE_VALUES_HELD",
      reasons: [
        `this generation carries ${String(hits.length)} value(s) this atlas may never hold, so nothing was written`,
        ...hits.slice(0, 8).map((hit) => `  ${hit.path}: ${hit.reason}`),
        "fix the selection in settingSurfaces.ts rather than the gate — a redacting gate would leave a generation silently different from what was read",
      ],
    }),
  }),
  settingsReadFailed: ({ surface, cause }: { surface: string; cause: unknown }): SettingsReadError => ({
    cause,
    code: "SETTINGS_READ_FAILED",
    message: cause instanceof Error ? `reading ${surface} failed: ${cause.message}` : `reading ${surface} failed`,
    surface,
  }),
  workspaceCrossed: ({ after, before, remedy }: { after: string; before: string; remedy: string }): LinearAtlasError =>
    listed({
      code: "WORKSPACE_CROSSED",
      reasons: [
        `this generation was published from workspace ${before} and this run read workspace ${after}`,
        "the store accumulates, so publishing across workspaces would leave the first one's configuration marked stale — which reads as Linear having deleted it",
        remedy,
      ],
    }),
} as const;

/**
 * The lines a {@link LinearAtlasError} prints, one per problem. A list-carrying variant gives each entry its
 * own line, as the `readonly string[]` it replaced did, rather than the joined `message`.
 *
 * @param error the Linear failure to render, list-carrying or single-sentence
 * @returns one line per problem, in the order they were found
 */
export function linearAtlasErrorLines({ error }: { error: LinearAtlasError }): readonly string[] {
  if (error.code === "WORKSPACE_CROSSED" || error.code === "NOTHING_READ" || error.code === "SENSITIVE_VALUES_HELD") {
    return error.reasons;
  }
  return [error.message];
}
