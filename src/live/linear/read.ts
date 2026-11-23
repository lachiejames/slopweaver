/** A current, single-object Linear read through the shared GraphQL transport and its one quota scheduler. */

import { LinearDocument } from "@linear/sdk";
import { sharedLinearTransport } from "../../corpus/linear/transport.js";

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { collectPaginationResidue, type ProviderReadDocument, type ProviderReadTarget } from "../providerRead.js";
import { openLinearAssets } from "./assetDocuments.js";
import type { FetchLinearAsset } from "./assetFetch.js";
import { type LinearLiveError, LinearLiveErrors } from "./errors.js";
import { readProjectTeams } from "./projectTeams.js";
import {
  activityOf,
  type LinearActivityKind,
  type LinearObjectKind,
  type LinearReadInclude,
  planLinearActivity,
  readLinearActivity,
} from "./readActivity.js";

export { type LinearReadInclude, parseLinearReadInclude } from "./readActivity.js";

interface LinearAddress extends ProviderReadTarget {
  readonly kind: LinearObjectKind;
  readonly id: string;
}

/** The injected request seam. Production uses the process-wide safe, paced Linear transport. */
export type LinearReadRequest = (args: {
  query: string;
  variables: Readonly<Record<string, unknown>>;
}) => Promise<Result<unknown, LinearLiveError>>;

/**
 * The object documents, and the ACTIVITY documents a caller may ask for on top of one.
 *
 * A read passes options in to whichever verb it uses, because sometimes the full history is wanted, comments and
 * activity included, and often it is not. A read that does not need that information does not ask for it: a
 * full-SDK-versus-fast-path choice is the wrong question, and the right tool is whichever asks for only what
 * the caller needs.
 *
 * A document that asked for every connection on every read would make a bot answering a Slack thread pay for the
 * activity history it never looks at. Splitting them is what makes the option expressible at all: an SDK
 * document selects one root, so "what do you need?" becomes "which documents do I send?".
 *
 * MEASURED against a real issue, through this repo's own gated transport:
 *
 * | what the caller asks for              | requests | complexity | wall clock |
 * | ------------------------------------- | -------- | ---------- | ---------- |
 * | the old always-everything query       | 1        | 119        | 2,116 ms   |
 * | the issue alone                       | 1        | 29         | 2,146 ms   |
 * | the issue and its comments            | 2        | 56         | 4,246 ms   |
 * | everything, which the corpus sync wants | 4      | 1,843      | 8,673 ms   |
 *
 * So the light read is 4x cheaper in complexity at identical wall clock, and a read that needs comments
 * costs one extra round trip — Linear answers in ~2.1s whatever the payload, so latency here is round trips
 * rather than bytes. Reproduce with `~/.slopweaver/probes/linear-sdk-<date>/probe-options.ts`.
 */
const ISSUE_QUERY = String(LinearDocument.IssueDocument);
const PROJECT_QUERY = String(LinearDocument.ProjectDocument);
const DOCUMENT_QUERY = String(LinearDocument.DocumentDocument);

/** Either a resolved issue shortcut (bare identifier, no URL needed) or a single URL candidate to parse. */
type AddressCandidate =
  { readonly kind: "issue"; readonly identifier: string } | { readonly kind: "url"; readonly candidate: string };

/**
 * Resolve the question text to exactly one address candidate: a bare issue identifier (`ABC-123`) needs no
 * URL at all, otherwise the one `linear.app` URL found. Refuses when more than one URL or identifier appears.
 *
 * @param address the user-supplied identifier or URL
 * @returns the resolved candidate, or an actionable refusal
 */
function resolveAddressCandidate({ address }: { address: string }): Result<AddressCandidate, LinearLiveError> {
  const urlCandidates = [
    ...new Set(
      [...address.matchAll(/https:\/\/linear\.app\/[^\s)>\]"']+/giu)].map((match) =>
        match[0].replace(/[.,;:!?]+$/u, ""),
      ),
    ),
  ];
  if (urlCandidates.length > 1) {
    return err(
      LinearLiveErrors.ambiguousAddress({
        message: "Linear read needs exactly one object address; the question contains more than one URL",
      }),
    );
  }
  if (urlCandidates.length === 0) {
    const identifiers = [...new Set([...address.matchAll(/\b[A-Z][A-Z0-9]+-\d+\b/gu)].map((match) => match[0]))];
    if (identifiers.length > 1) {
      return err(
        LinearLiveErrors.ambiguousAddress({
          message: "Linear read needs exactly one issue identifier; the question contains more than one",
        }),
      );
    }
    const identifier = identifiers[0];
    if (identifier !== undefined) {
      return ok({ identifier, kind: "issue" });
    }
    return ok({ candidate: address, kind: "url" });
  }
  // Exactly one candidate: more than one and none both returned above.
  return ok({ candidate: urlCandidates[0]!, kind: "url" });
}

/**
 * Parse one resolved `linear.app` URL candidate into its object kind + id.
 *
 * @param candidate the URL string to parse
 * @returns the typed target, or an actionable refusal
 */
function parseLinearUrl({ candidate }: { candidate: string }): Result<LinearAddress, LinearLiveError> {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return err(
      LinearLiveErrors.invalidAddress({
        message: "Linear read needs an issue identifier or a full linear.app issue, project or document URL",
      }),
    );
  }
  if (url.protocol !== "https:" || url.hostname !== "linear.app") {
    return err(
      LinearLiveErrors.invalidAddress({
        message: `Linear read accepts only https://linear.app links, got ${candidate}`,
      }),
    );
  }
  const parts = url.pathname.split("/").filter((part) => part.length > 0);
  const families: Readonly<Record<string, LinearObjectKind>> = {
    document: "document",
    issue: "issue",
    project: "project",
  };
  const familyIndex = parts.findIndex((part) => families[part] !== undefined);
  const family = familyIndex >= 0 ? parts[familyIndex] : undefined;
  const id = familyIndex >= 0 ? parts[familyIndex + 1] : undefined;
  const kind = family === undefined ? undefined : families[family];
  if (kind === undefined || id === undefined || id.length === 0) {
    return err(
      LinearLiveErrors.invalidAddress({
        message: "expected a linear.app URL containing /issue/<id>, /project/<id> or /document/<id>",
      }),
    );
  }
  return ok({ address: candidate, id: decodeURIComponent(id), identity: decodeURIComponent(id), kind });
}

/**
 * Parse a Linear issue identifier or a Linear issue, project or document URL without reading credentials.
 *
 * @param address the user-supplied identifier or URL
 * @returns the typed target, or an actionable refusal
 */
export function parseLinearReadAddress({ address }: { address: string }): Result<LinearAddress, LinearLiveError> {
  const resolved = resolveAddressCandidate({ address });
  if (resolved.isErr()) {
    return err(resolved.error);
  }
  return resolved.value.kind === "issue"
    ? ok({
        address: resolved.value.identifier,
        id: resolved.value.identifier,
        identity: resolved.value.identifier,
        kind: "issue",
      })
    : parseLinearUrl({ candidate: resolved.value.candidate });
}

/** The query and root response field owned by one Linear object kind. */
function queryFor({ kind }: { kind: LinearObjectKind }): { query: string; field: LinearObjectKind } {
  if (kind === "issue") {
    return { field: kind, query: ISSUE_QUERY };
  }
  if (kind === "project") {
    return { field: kind, query: PROJECT_QUERY };
  }
  return { field: kind, query: DOCUMENT_QUERY };
}

/**
 * What this read did NOT establish, before any file it addresses is opened.
 *
 * The connections not asked for are NAMED, so a reader can tell "this issue has no comments" from "nobody
 * asked about comments". That distinction is the whole value of the option being explicit.
 *
 * @param data the assembled payload, walked for a connection with another page
 * @param kind the object kind, whose own connections are the ones that can have been skipped
 * @param wanted the connections the caller did ask for
 * @returns the residue lines, mutable so the asset stage can append its own
 */
function residueFor({
  data,
  kind,
  wanted,
}: {
  data: unknown;
  kind: LinearObjectKind;
  wanted: readonly LinearActivityKind[];
}): string[] {
  const residue: string[] = ["only fields declared by the typed live-reader query were requested"];
  const skipped = activityOf({ kind }).filter((name) => !wanted.includes(name));
  if (skipped.length > 0) {
    residue.push(`not requested, so not read: ${skipped.join(", ")}`);
  }
  collectPaginationResidue({ out: residue, path: "data", value: data });
  return residue;
}

/** The coverage line: what the read asked for beyond the object itself. Pure. */
function coverageDetail({ limit, wanted }: { limit: number; wanted: readonly LinearActivityKind[] }): string {
  if (wanted.length === 0) {
    return "one named object, with no activity connections requested";
  }
  return `one named object, with up to ${String(limit)} items from each of: ${wanted.join(", ")}`;
}

/**
 * Read one current Linear object.
 *
 * @param address an issue identifier or Linear object URL
 * @param limit the maximum items requested from each selected connection
 * @param request the shared safe GraphQL transport
 * @param nowIso the freshness clock
 * @param assets the credential and byte seam for opening the files this object addresses; omitted means
 *   none are opened, which is a different answer from opening none and is reported as one
 * @returns a bounded provider document, or a named read failure
 */
export async function readLinearObject({
  address,
  limit,
  request,
  nowIso,
  include = {},
  assets,
}: {
  address: string;
  limit: number;
  request: LinearReadRequest;
  nowIso: () => string;
  include?: LinearReadInclude;
  assets?: { readonly token: string; readonly fetchAsset: FetchLinearAsset };
}): Promise<Result<ProviderReadDocument, LinearLiveError>> {
  const parsed = parseLinearReadAddress({ address });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  // Refused before any request: an object read that then cannot carry what was asked for is a wasted call.
  const plan = planLinearActivity({ include, kind: parsed.value.kind });
  if (plan.isErr()) {
    return err(plan.error);
  }
  const wanted = plan.value;
  const selected = queryFor({ kind: parsed.value.kind });
  const response = await request({ query: selected.query, variables: { id: parsed.value.id, limit } });
  if (response.isErr()) {
    return err(response.error);
  }
  const node = isRecord(response.value) ? response.value[selected.field] : undefined;
  if (node === null || node === undefined) {
    return err(LinearLiveErrors.notFound({ identity: parsed.value.identity, kind: parsed.value.kind }));
  }
  const activity = await readLinearActivity({ id: parsed.value.id, kind: parsed.value.kind, limit, request, wanted });
  if (activity.isErr()) {
    return err(activity.error);
  }
  const teams = await readProjectTeams({ id: parsed.value.id, kind: parsed.value.kind, request });
  if (teams.isErr()) {
    return err(teams.error);
  }
  const data = { ...node, ...activity.value, ...teams.value };
  const residue = residueFor({ data, kind: parsed.value.kind, wanted });
  // Opened AFTER the payload is complete, and from the payload itself: an asset URL can sit in a
  // description, in a comment body or on an attachment node, so there is nothing to fetch until every
  // requested connection has arrived.
  const opened = assets === undefined ? undefined : await openLinearAssets({ data, ...assets });
  if (opened !== undefined) {
    residue.push(...opened.residue);
  }
  return ok({
    ...(opened === undefined ? {} : { attachments: opened.attachments }),
    coverage: { detail: coverageDetail({ limit, wanted }), kind: "bounded", residue },
    data,
    readAtIso: nowIso(),
    source: "linear",
    target: parsed.value,
  });
}

/**
 * A project's status updates, which the SDK's `ProjectDocument` does NOT select — it carries `lastUpdate { id }`
 * and no `projectUpdates` connection at all. Reading the object alone and looking for updates on it answered
 * "never updated" for every project, measured on three projects each holding a real update.
 */
const PROJECT_UPDATES_QUERY = String(LinearDocument.Project_ProjectUpdatesDocument);

/**
 * Read one project's `projectUpdates` connection, newest first.
 *
 * Answers the provider's own connection object (`{nodes, pageInfo}`) untouched, so a caller parses it with the
 * same reader bronze's copy goes through. `orderBy: createdAt` is stated rather than inherited: the newest
 * update is the fact a caller wants, and it is only guaranteed to be on the first page when the order says so.
 *
 * @param address a Linear project URL
 * @param limit the most updates requested on the one page read
 * @param request the shared safe GraphQL transport
 * @returns the connection, or a named read failure
 */
export async function readLinearProjectUpdates({
  address,
  limit,
  request,
}: {
  address: string;
  limit: number;
  request: LinearReadRequest;
}): Promise<Result<unknown, LinearLiveError>> {
  const parsed = parseLinearReadAddress({ address });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  if (parsed.value.kind !== "project") {
    return err(LinearLiveErrors.invalidAddress({ message: `expected a linear.app project URL, got ${address}` }));
  }
  const response = await request({
    query: PROJECT_UPDATES_QUERY,
    variables: { first: limit, id: parsed.value.id, orderBy: "createdAt" },
  });
  if (response.isErr()) {
    return err(response.error);
  }
  const project = isRecord(response.value) ? response.value["project"] : undefined;
  if (!isRecord(project)) {
    return err(LinearLiveErrors.notFound({ identity: parsed.value.identity, kind: "project" }));
  }
  return ok(project["projectUpdates"]);
}

/**
 * Build the production request seam over Linear's process-wide paced transport.
 *
 * @param token the configured Linear API key
 * @returns a result-returning request seam
 */
export function linearReadRequest({ token }: { token: string }): LinearReadRequest {
  const transport = sharedLinearTransport({ token });
  return async ({ query, variables }) => {
    try {
      return ok(await transport.request({ query, variables: { ...variables } }));
    } catch (error: unknown) {
      return err(
        LinearLiveErrors.readFailed({
          cause: error,
          message: error instanceof Error ? error.message : "Linear named-object read failed",
        }),
      );
    }
  };
}
