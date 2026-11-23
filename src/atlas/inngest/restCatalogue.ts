/**
 * Compiling Inngest's published REST catalogue out of the one machine-readable document that still answers.
 *
 * ## Why `llms.txt` and not a specification
 *
 * Inngest publishes no OpenAPI document anywhere this atlas could find. Four addresses were tried and all
 * four answered 404 — `api.inngest.com/openapi.json`, `…/v1/openapi.json`, `…/v1/doc` and
 * `api-docs.inngest.com/openapi.json`. What the API reference DOES serve is
 * {@link INNGEST_REST_CATALOGUE_URL}, an `llms.txt` naming every operation with its version, its group, its
 * title and its own description.
 *
 * ## The reference's markdown mirror is BROKEN, and that is a finding rather than a nuisance
 *
 * MEASURED, and it is why the compiled channel carries no HTTP method and no path template:
 *
 * ```bash
 * curl -so /dev/null -w '%{http_code}\n' https://api-docs.inngest.com/llms.txt          # 200
 * curl -so /dev/null -w '%{http_code}\n' https://api-docs.inngest.com/llms-full.txt     # 500
 * curl -so /dev/null -w '%{http_code}\n' https://api-docs.inngest.com/v1/events/ListEvents.md  # 500
 * ```
 *
 * The `.md` address is the one the site's OWN client bundle asks for — `useContent(path, { markdownUrl })`
 * in `assets/index-CsVDGpun.js` builds exactly it — and `robots.txt` on `www.inngest.com` advertises the
 * markdown mirror to AI crawlers by name. So the operation's method and path are rendered into a page and
 * served to nobody who is not a browser. The atlas records what it has, and opens a
 * `vendor-document-errors` gap carrying the three commands above rather than guessing the missing half:
 * `POST /v2/apps/{appID}/sync` inferred from the words "Sync app" would read exactly like evidence and be
 * nothing of the kind.
 *
 * What DOES bind an address to an operation is a probe, and only where the platform discriminates —
 * `restAddresses.ts`.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { InngestAtlasErrors, inngestAtlasErrorLines } from "./errors.js";
import type { InngestRestVersion } from "./model.js";

/** The one machine-readable document Inngest's API reference still serves. */
export const INNGEST_REST_CATALOGUE_URL = "https://api-docs.inngest.com/llms.txt";

/** The origin every published REST operation is served from. */
export const INNGEST_REST_ORIGIN = "https://api.inngest.com";

/** The API reference's own origin, which every operation's `referenceUrl` hangs off. */
export const INNGEST_REST_REFERENCE_ORIGIN = "https://api-docs.inngest.com";

/**
 * The three addresses whose failure is the finding, checked on every sync so the gap closes itself the day
 * Inngest fixes them.
 */
export const INNGEST_MARKDOWN_MIRROR_URLS = [
  `${INNGEST_REST_REFERENCE_ORIGIN}/llms-full.txt`,
  `${INNGEST_REST_REFERENCE_ORIGIN}/v1/events/ListEvents.md`,
] as const;

/** One operation exactly as the published catalogue declares it. */
export interface InngestCatalogueOperation {
  /** The catalogue's own description, or `null` when it prints none. */
  readonly description: string | null;
  /** The catalogue's own grouping heading, e.g. `Events`, `Sandboxes`. */
  readonly group: string;
  /** The catalogue's own operation id, e.g. `ListEvents`. Unique within its version. */
  readonly operationId: string;
  /** The reference page this row came from — the reproduction handle. */
  readonly referenceUrl: string;
  /** The catalogue's own heading for this operation. */
  readonly title: string;
  readonly version: InngestRestVersion;
}

/**
 * A page of the reference that is not an operation — the overview, the authentication page, a version index.
 *
 * @internal
 */
export interface InngestCataloguePage {
  readonly title: string;
  readonly url: string;
}

/** Everything one catalogue read established. */
export interface InngestCatalogue {
  readonly operations: readonly InngestCatalogueOperation[];
  readonly pages: readonly InngestCataloguePage[];
}

/** `- v1` / `- v2` at the top level, which sets the version every following row belongs to. */
const VERSION_LINE = /^- (v[12])$/;

/** `- **Events**`, which sets the group every following operation belongs to, once the line is trimmed. */
const GROUP_LINE = /^- \*\*(.+)\*\*$/;

/**
 * `- [List events](/v1/events/ListEvents): Fetches recent events…`, once the line is trimmed.
 *
 * The leading indent is stripped by the caller rather than matched here, and the description is taken as
 * whatever follows the closing parenthesis rather than as an optional group. Both are the `redos-check`
 * gate's doing and both are improvements: a leading `\\s*` beside a trailing `(.*)` is polynomial
 * backtracking on a line that never matches, and this document is 25 KB of lines that mostly do not.
 */
const LINK_LINE = /^- \[([^\]]+)\]\(([^)]+)\)([^]*)$/;

/** An operation's own address within the reference: `/v1/<group-slug>/<OperationId>`. */
const OPERATION_PATH = /^\/(v[12])\/([a-z0-9-]+)\/([A-Za-z0-9_]+)$/;

/**
 * Whether one catalogue link is an operation rather than a page of prose.
 *
 * The test is the SHAPE of the reference address rather than the presence of a description or a group, and
 * that is deliberate: `- [v1 REST API](/v1)` sits inside the `v1` section and carries no description, while
 * `- [List sandboxes](/v2/sandboxes/ListSandboxes)` carries no description either and is an operation. Only
 * the three-segment address tells them apart.
 */
function operationPathParts({ path }: { path: string }): { group: string; operationId: string } | null {
  const match = OPERATION_PATH.exec(path);
  if (match === null) {
    return null;
  }
  const [, , , operationId] = match;
  // Groups 2 and 3 are both non-optional in OPERATION_PATH, so a match guarantees them.
  return operationId === undefined ? null : { group: match[2]!, operationId };
}

/** What one catalogue line turned out to be, so the reader stays a dispatch rather than a nest of branches. */
type CatalogueLine =
  | { readonly kind: "version"; readonly version: InngestRestVersion }
  | { readonly kind: "group"; readonly group: string }
  | { readonly kind: "link"; readonly title: string; readonly path: string; readonly described: string }
  | { readonly kind: "other" };

/** Classify one already-trimmed line of the catalogue. */
function classifyLine({ line }: { line: string }): CatalogueLine {
  const versionMatch = VERSION_LINE.exec(line);
  if (versionMatch !== null) {
    return { kind: "version", version: versionMatch[1] === "v2" ? "v2" : "v1" };
  }
  const groupMatch = GROUP_LINE.exec(line);
  if (groupMatch !== null) {
    // GROUP_LINE's one group is non-optional and non-empty, so a match guarantees it.
    return { group: groupMatch[1]!, kind: "group" };
  }
  const linkMatch = LINK_LINE.exec(line);
  if (linkMatch === null) {
    return { kind: "other" };
  }
  // All three groups are non-optional in LINK_LINE, so a match guarantees them; the third may be empty.
  return {
    described: linkMatch[3]!.replace(/^:\s*/, "").trim(),
    kind: "link",
    path: linkMatch[2]!,
    title: linkMatch[1]!,
  };
}

/** Where the reader is, as it walks the document's own headings. */
interface CatalogueCursor {
  group: string | null;
  version: InngestRestVersion | null;
}

/** What reading one link line came to: an operation, a page, or a document that changed shape. */
type LinkVerdict =
  | { readonly kind: "operation"; readonly operation: InngestCatalogueOperation }
  | { readonly kind: "page"; readonly page: InngestCataloguePage }
  | { readonly kind: "unattributable"; readonly reason: string };

/** Read one link line against where the reader currently is in the document. */
function readLink({
  link,
  cursor,
}: {
  link: { readonly title: string; readonly path: string; readonly described: string };
  cursor: CatalogueCursor;
}): LinkVerdict {
  const parts = operationPathParts({ path: link.path });
  const url = `${INNGEST_REST_REFERENCE_ORIGIN}${link.path}`;
  if (parts === null) {
    return { kind: "page", page: { title: link.title, url } };
  }
  if (cursor.version === null || cursor.group === null) {
    return {
      kind: "unattributable",
      reason:
        `the catalogue declares operation ${parts.operationId} at ${link.path} before any version or group ` +
        "heading, so it cannot be attributed — the document's shape has changed",
    };
  }
  return {
    kind: "operation",
    operation: {
      description: link.described === "" ? null : link.described,
      group: cursor.group,
      operationId: parts.operationId,
      referenceUrl: url,
      title: link.title,
      version: cursor.version,
    },
  };
}

/**
 * Compile the published catalogue into operations and pages.
 *
 * A row is attributed to the version whose `- vN` heading most recently preceded it, and to the group whose
 * `**Group**` heading most recently preceded it within that version — which is how the document is written,
 * so an operation appearing before any group heading is a document that changed shape rather than a row to
 * guess a group for, and is refused.
 *
 * @param text the catalogue document exactly as served
 * @returns every operation and page it declares, or why it could not be read
 */
export function compileInngestCatalogue({ text }: { text: string }): Result<InngestCatalogue> {
  const operations: InngestCatalogueOperation[] = [];
  const pages: InngestCataloguePage[] = [];
  const reasons: string[] = [];
  const cursor: CatalogueCursor = { group: null, version: null };
  for (const raw of text.split("\n")) {
    const classified = classifyLine({ line: raw.trim() });
    if (classified.kind === "version") {
      cursor.version = classified.version;
      cursor.group = null;
    } else if (classified.kind === "group") {
      cursor.group = classified.group;
    } else if (classified.kind === "link") {
      const verdict = readLink({ cursor, link: classified });
      if (verdict.kind === "operation") {
        operations.push(verdict.operation);
      } else if (verdict.kind === "page") {
        pages.push(verdict.page);
      } else {
        reasons.push(verdict.reason);
      }
    }
  }
  if (reasons.length > 0) {
    return err(reasons);
  }
  if (operations.length === 0) {
    return err(
      inngestAtlasErrorLines({ error: InngestAtlasErrors.catalogueEmpty({ url: INNGEST_REST_CATALOGUE_URL }) }),
    );
  }
  return ok({ operations, pages });
}

/**
 * The provider key one operation is matched on, byte-exactly, across channels and across runs.
 *
 * The version is part of it because `ListWebhooks` exists in both v1 and v2 and they are different
 * operations against different addresses — keying on the id alone would silently fold two rows into one.
 *
 * @param operation the catalogued operation
 * @returns the provider key
 */
export function inngestOperationProviderId({
  operation,
}: {
  operation: Pick<InngestCatalogueOperation, "operationId" | "version">;
}): string {
  return `${operation.version} ${operation.operationId}`;
}
