/**
 * The typed failures this atlas raises ITSELF — resolving the credential (`credentialFiles.ts`), reading
 * the Falcon sitemap (`sitemap.ts`), refusing an empty walk (`consoleWalk.ts`), identifying a record
 * (`projectionEnvelope.ts`), and refusing to publish a walk or a generation (`consoleSurface.ts`,
 * `store.ts`, `sync.ts`).
 *
 * A union of its own rather than more variants on `errors.ts`'s `CrowdstrikeError`, because that one is the
 * API-call failure union, switched exhaustively where a gap or a coverage cell is graded — these are
 * genuinely distinct failure kinds (`.claude/rules/error-handling.md`), never an API answer. A variant
 * carrying `reasons` keeps one line per problem, and {@link crowdstrikeAtlasErrorLines} is how a caller
 * prints them without re-composing the joined `message`.
 *
 * No variant carries a credential VALUE: the credential failures carry environment-variable and
 * secret-store NAMES and the scheme only, and are raised before any secret file is read. An identity
 * failure names the kind and the field, never the raw record.
 *
 * Pure: values in, values out.
 */
import type { CrowdstrikeKind } from "./model.js";

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
 * Every way the CrowdStrike atlas refuses a credential, a sitemap, a walk, a record or a publish.
 *
 * @internal
 */
export type CrowdstrikeAtlasError =
  | Plain<"HOST_EMPTY">
  | Plain<"HOST_NOT_URL">
  | (Plain<"HOST_NOT_HTTPS"> & { readonly protocol: string })
  | (Plain<"ENV_PARTIAL"> & { readonly missing: readonly string[] })
  | (Plain<"CREDENTIALS_ABSENT"> & { readonly secretNames: readonly [string, string, string] })
  | (Plain<"STORE_PARTIAL"> & { readonly missing: readonly string[] })
  | (Plain<"PROVIDER_ID_ABSENT"> & { readonly kind: CrowdstrikeKind; readonly field: string })
  | Plain<"SITEMAP_ORIGIN_INVALID">
  | Plain<"SITEMAP_WITHOUT_HREF">
  | Plain<"ROUTES_UNDECLARED">
  | Listed<"WALK_UNPUBLISHABLE">
  | Listed<"GENERATION_UNPUBLISHABLE">;

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const CrowdstrikeAtlasErrors = {
  credentialsAbsent: ({ secretNames }: { secretNames: readonly [string, string, string] }): CrowdstrikeAtlasError => {
    const [host, clientId, clientSecret] = secretNames;
    return {
      code: "CREDENTIALS_ABSENT",
      message: `CrowdStrike credentials are not configured: ${host}, ${clientId} and ${clientSecret} are all required. Set each with: slopweaver secrets set <name>`,
      secretNames,
    };
  },
  envPartial: ({ missing }: { missing: readonly string[] }): CrowdstrikeAtlasError => ({
    code: "ENV_PARTIAL",
    message: `CrowdStrike credentials are partly set in the environment; missing: ${missing.join(", ")}`,
    missing,
  }),
  generationUnpublishable: ({ problems }: { problems: readonly string[] }): CrowdstrikeAtlasError =>
    listed({
      code: "GENERATION_UNPUBLISHABLE",
      reasons: [...problems, "nothing was written — this generation is not published"],
    }),
  hostEmpty: (): CrowdstrikeAtlasError => ({ code: "HOST_EMPTY", message: "the CrowdStrike API host is empty" }),
  hostNotHttps: ({ protocol }: { protocol: string }): CrowdstrikeAtlasError => ({
    code: "HOST_NOT_HTTPS",
    message: `the CrowdStrike API host must be https, not ${protocol}`,
    protocol,
  }),
  // The host is quoted in the sentence exactly as it always was, but deliberately kept out of any field of
  // its own, so no later caller is invited to log or persist it structurally.
  hostNotUrl: ({ host }: { host: string }): CrowdstrikeAtlasError => ({
    code: "HOST_NOT_URL",
    message: `the CrowdStrike API host is not a URL: ${host}`,
  }),
  providerIdAbsent: ({ kind, field }: { kind: CrowdstrikeKind; field: string }): CrowdstrikeAtlasError => ({
    code: "PROVIDER_ID_ABSENT",
    field,
    kind,
    message: `a ${kind} record carried no ${field}, so it cannot be given a stable identity`,
  }),
  routesUndeclared: (): CrowdstrikeAtlasError => ({
    code: "ROUTES_UNDECLARED",
    message: "the Falcon sitemap declared no routes, so a walk would report full coverage over nothing",
  }),
  sitemapOriginInvalid: ({ origin }: { origin: string }): CrowdstrikeAtlasError => ({
    code: "SITEMAP_ORIGIN_INVALID",
    message: `sitemap origin is not a URL: ${origin}`,
  }),
  sitemapWithoutHref: (): CrowdstrikeAtlasError => ({
    code: "SITEMAP_WITHOUT_HREF",
    message:
      "the Falcon sitemap declared no href at all — the document shape has changed, and walking zero pages would report full coverage over nothing",
  }),
  // Only each entry's NAME is copied: an entry's `path` embeds the home directory and its `label` is a
  // display string, and neither belongs in a failure a caller may print or persist.
  storePartial: ({ absent }: { absent: readonly { readonly name: string }[] }): CrowdstrikeAtlasError => {
    const missing = absent.map((entry) => entry.name);
    return {
      code: "STORE_PARTIAL",
      message: `the secrets store holds only part of the CrowdStrike credential; missing: ${missing.join(", ")}`,
      missing,
    };
  },
  walkUnpublishable: ({ problems }: { problems: readonly string[] }): CrowdstrikeAtlasError =>
    listed({ code: "WALK_UNPUBLISHABLE", reasons: [...problems, "nothing was written — this walk is not published"] }),
} as const;

/**
 * The lines one failure prints, one log record each, exactly as the atlas returned them before it had a
 * type: a list-carrying failure as its list, and every other failure as its one message.
 *
 * @param error the CrowdStrike atlas failure to render
 * @returns the lines, in order
 */
export function crowdstrikeAtlasErrorLines({ error }: { error: CrowdstrikeAtlasError }): readonly string[] {
  if (error.code === "WALK_UNPUBLISHABLE" || error.code === "GENERATION_UNPUBLISHABLE") {
    return error.reasons;
  }
  return [error.message];
}
