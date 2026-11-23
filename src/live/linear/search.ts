/** Search current Linear issues and projects by term through the shared GraphQL transport and its quota scheduler. */

import { LinearDocument } from "@linear/sdk";

import { sharedLinearTransport } from "../../corpus/linear/transport.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type LinearLiveError, LinearLiveErrors } from "./errors.js";

/** The kind of Linear object one search result names. */
type LinearSearchKind = "issue" | "project";

/** Enough to identify one matching object and link to it — never the full object. */
interface LinearSearchResult {
  readonly kind: LinearSearchKind;
  readonly id: string;
  readonly identifier: string | undefined;
  readonly title: string;
  readonly url: string;
}

/** The result of searching Linear by term: every matching issue and project it ranked, or none. */
export interface LinearSearchDocument {
  readonly source: "linear";
  readonly term: string;
  readonly readAtIso: string;
  readonly results: readonly LinearSearchResult[];
}

/**
 * The two searches, bound to `@linear/sdk`'s own generated documents.
 *
 * Both fragments are far wider than the four fields {@link LinearSearchResult} keeps, and the cost of that
 * is worth stating rather than discovering. MEASURED live through this repo's gated transport,
 * `term: "staging"`, `first: 10` (probe in `~/.slopweaver/probes/linear-sdk-<date>/`):
 *
 * | lane             | ours          | SDK document     |
 * | ---------------- | ------------- | ---------------- |
 * | `searchIssues`   | 3 pts, 2.2 KB | 35 pts, 29 KB    |
 * | `searchProjects` | 3 pts, 1.9 KB | 36 pts, 304 KB   |
 *
 * The complexity is noise against a 3,000,000/hour budget. The BYTES are the honest cost, and the projects
 * figure is the one to know: `ProjectSearchResult` carries `scopeHistory`, `issueCountHistory`,
 * `completedScopeHistory` and the whole `documentContent`, so ten project names arrive inside 304 KB. That
 * is well under `safeJsonParse`'s 32 MiB warn, and it is paid once per search rather than per result.
 */
const SEARCH_ISSUES_QUERY = String(LinearDocument.SearchIssuesDocument);

const SEARCH_PROJECTS_QUERY = String(LinearDocument.SearchProjectsDocument);

/** The injected request seam. Production uses the process-wide safe, paced Linear transport. */
export type LinearSearchRequest = (args: {
  query: string;
  variables: Readonly<Record<string, unknown>>;
}) => Promise<Result<unknown, LinearLiveError>>;

/** The `nodes` array under one root search field, defensively narrowed. Pure. */
function searchNodes({ field, value }: { field: string; value: unknown }): readonly Record<string, unknown>[] {
  const root = isRecord(value) ? value[field] : undefined;
  const nodes = isRecord(root) ? root["nodes"] : undefined;
  return Array.isArray(nodes) ? nodes.filter(isRecord) : [];
}

/** `searchIssues` nodes shaped into results, dropping any node missing an id/title/url. Pure. */
function issueResults({ value }: { value: unknown }): readonly LinearSearchResult[] {
  return searchNodes({ field: "searchIssues", value }).flatMap((node) => {
    const id = node["id"];
    const title = node["title"];
    const url = node["url"];
    if (typeof id !== "string" || typeof title !== "string" || typeof url !== "string") {
      return [];
    }
    const identifier = node["identifier"];
    return [{ id, identifier: typeof identifier === "string" ? identifier : undefined, kind: "issue", title, url }];
  });
}

/** `searchProjects` nodes shaped into results, dropping any node missing an id/title/url. Pure. */
function projectResults({ value }: { value: unknown }): readonly LinearSearchResult[] {
  return searchNodes({ field: "searchProjects", value }).flatMap((node) => {
    const id = node["id"];
    const title = node["name"];
    const url = node["url"];
    return typeof id !== "string" || typeof title !== "string" || typeof url !== "string"
      ? []
      : [{ id, identifier: undefined, kind: "project" as const, title, url }];
  });
}

/**
 * Search current Linear issues and projects by term.
 *
 * @param term the free-text search term
 * @param limit the maximum results requested per object kind
 * @param request the shared safe GraphQL transport
 * @param nowIso the freshness clock
 * @returns every matching issue and project Linear's own search ranked, or a named search failure
 */
export async function searchLinear({
  term,
  limit,
  request,
  nowIso,
}: {
  term: string;
  limit: number;
  request: LinearSearchRequest;
  nowIso: () => string;
}): Promise<Result<LinearSearchDocument, LinearLiveError>> {
  const [issues, projects] = await Promise.all([
    request({ query: SEARCH_ISSUES_QUERY, variables: { first: limit, term } }),
    request({ query: SEARCH_PROJECTS_QUERY, variables: { first: limit, term } }),
  ]);
  if (issues.isErr()) {
    return err(issues.error);
  }
  if (projects.isErr()) {
    return err(projects.error);
  }
  return ok({
    readAtIso: nowIso(),
    results: [...issueResults({ value: issues.value }), ...projectResults({ value: projects.value })],
    source: "linear",
    term,
  });
}

/**
 * Build the production request seam over Linear's process-wide paced transport.
 *
 * @param token the configured Linear API key
 * @returns a result-returning request seam
 */
export function linearSearchRequest({ token }: { token: string }): LinearSearchRequest {
  const transport = sharedLinearTransport({ token });
  return async ({ query, variables }) => {
    try {
      return ok(await transport.request({ query, variables: { ...variables } }));
    } catch (error: unknown) {
      return err(
        LinearLiveErrors.searchFailed({
          cause: error,
          message: error instanceof Error ? error.message : "Linear search failed",
        }),
      );
    }
  };
}

/**
 * Render a search document as stable, pretty JSON.
 *
 * @param document the Linear search document
 * @returns one JSON document, with a trailing newline supplied by the logger rather than embedded here
 */
export function renderLinearSearchJson({ document }: { document: LinearSearchDocument }): string {
  return JSON.stringify(document, undefined, 2);
}

/**
 * Render a search document as a human-readable list, with "no match" as an explicit, first-class outcome.
 *
 * @param document the Linear search document
 * @returns text listing every match, or saying plainly that there were none
 */
export function renderLinearSearchText({ document }: { document: LinearSearchDocument }): string {
  if (document.results.length === 0) {
    return `linear search: "${document.term}" — no matching issue or project\nread at: ${document.readAtIso}`;
  }
  const lines = document.results.map((result) =>
    result.kind === "issue"
      ? `  issue    ${result.identifier ?? result.id}  ${result.title}  ${result.url}`
      : `  project  ${result.id}  ${result.title}  ${result.url}`,
  );
  return [
    `linear search: "${document.term}" — ${String(document.results.length)} match(es)`,
    `read at: ${document.readAtIso}`,
    ...lines,
  ].join("\n");
}
