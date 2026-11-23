/**
 * Turn what the Inngest dashboard asked for into atlas rows — the OPERATION it called and the field NAMES
 * that came back, never a value.
 *
 * ## This file is the redaction, and it is committed so a reviewer can read it rather than trust it
 *
 * A signed-in Inngest session sees every event this organisation has sent and every step output its
 * functions produced. The browser channel records what the client can ASK FOR, never what those runs
 * contain, so the reduction is a thing a reviewer reads once here. The walk and the redaction pass are
 * `kit/responseShape.ts`, shared with the Slack, Vanta, CrowdStrike, Notion and Xero atlases; what is
 * Inngest's own is here.
 *
 * ## The GraphQL identity comes from the REQUEST document, never the response
 *
 * `api.inngest.com/gql` answers every operation at one path, so the path shape identifies nothing. What
 * identifies an operation is its own name and the root fields it selected — and both live in the request.
 * Reading the RESPONSE's top-level keys instead would read the document's ALIASES as schema field names,
 * which `kit/graphqlDocument.ts` carries the measured reason for refusing: it manufactures disagreements in
 * an instrument whose whole purpose is finding real ones.
 *
 * A request carrying no readable document is COUNTED and never attributed. It becomes an `unnamed` row so a
 * reader can see the walk saw traffic it could not name, rather than a silence that looks like no traffic.
 */
import { absentAs } from "#lib/absent.js";
import type { CapturedResponse } from "../../browser/pageTransport.js";
import { resolveRootFields } from "../kit/graphqlDocument.js";
import { responseFieldPaths, type SegmentClassifier } from "../kit/responseShape.js";

/**
 * The registrable domain every first-party Inngest host sits under.
 *
 * @internal
 */
export const INNGEST_DOMAIN = "inngest.com";

/**
 * The one path every GraphQL operation is posted to.
 *
 * @internal
 */
export const INNGEST_GRAPHQL_PATH = "/gql";

/**
 * How deep into a response body the field census walks before it stops.
 *
 * @internal
 */
export const INNGEST_PATH_DEPTH = 2;

/** A ULID, which is what Inngest identifies a run, an event and an app by. */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/** A uuid in any segment, dashed or bare. */
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** A bare run of digits — a numeric id, an epoch, or a page offset. */
const DIGITS_ONLY = /^[0-9]+$/;

/**
 * Inngest's own value-segment shapes, handed to the kit's redaction pass.
 *
 * @returns the placeholder to substitute, or `null` for a segment that is a real path name
 * @internal
 */
export const INNGEST_SEGMENTS: SegmentClassifier = ({ segment }) => {
  if (ULID.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "{ulid}" };
  }
  if (UUID.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "{id}" };
  }
  if (DIGITS_ONLY.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "{n}" };
  }
  return null;
};

/** One call the dashboard made, reduced to what may be stored. */
export interface InngestObservedCall {
  /** Every field name observed in the response body, sorted. Names only, never a value. */
  readonly fields: readonly string[];
  /** The host the call went to, which distinguishes the public API from the dashboard's own origin. */
  readonly host: string;
  readonly method: string;
  /** The GraphQL operation's own name, or `null` for a call that is not one. */
  readonly operationName: string | null;
  /** `query`, `mutation`, `subscription`, `unnamed` for a GraphQL call, or `null` for anything else. */
  readonly operationType: "query" | "mutation" | "subscription" | "unnamed" | null;
  /** The path with every value segment replaced. */
  readonly pathShape: string;
  /** The root selections the sent DOCUMENT asked for, sorted. Empty for a call that is not GraphQL. */
  readonly rootFields: readonly string[];
  readonly statusCode: number;
}

/**
 * A URL path with every identifier segment replaced.
 *
 * The kit's `redactValueSegments` splits on `.`, because its subject is a DOTTED field path — the same
 * classifier applied to `/v2/apps/<ulid>/functions` would see one segment and redact nothing. So the split
 * is here rather than reusing that helper on a path it was not written for, and the CLASSIFIER stays shared,
 * which is the half that matters: one place says what an Inngest identifier looks like.
 *
 * @param pathname the URL path, straight from the capture
 * @returns the path with every identifier segment replaced
 *
 * @internal
 */
export function redactedUrlPath({ pathname }: { pathname: string }): string {
  return pathname
    .split("/")
    .map((segment) => {
      const verdict = INNGEST_SEGMENTS({ segment });
      // No verdict is the classifier saying this segment is a real path name, which is kept as it is.
      if (verdict === null) {
        return segment;
      }
      return verdict.placeholder;
    })
    .join("/");
}

/** A URL, or `null` when it cannot be read. */
function parseUrl({ url }: { url: string }): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * Whether a host is Inngest's own, as a SUFFIX test rather than a substring one.
 *
 * Written to reject `notinngest.com` and `inngest.com.evil.test` alike: a sloppy `includes` here would admit
 * a third party's telemetry into a first-party surface map.
 *
 * @param host the host to judge
 * @returns whether it sits under Inngest's registrable domain
 */
export function isInngestHost({ host }: { host: string }): boolean {
  return host === INNGEST_DOMAIN || host.endsWith(`.${INNGEST_DOMAIN}`);
}

/** The operation type a parsed document's root-field keys imply, e.g. `query.apps` → `query`. */
function operationTypeOf({ rootFields }: { rootFields: readonly string[] }): InngestObservedCall["operationType"] {
  const first = rootFields[0];
  if (first === undefined) {
    return "unnamed";
  }
  const kind = first.split(".")[0];
  if (kind === "mutation" || kind === "subscription") {
    return kind;
  }
  return "query";
}

/**
 * The operation name the client declared in its own envelope.
 *
 * Only the `operationName` field is read, never `variables` — a variables object is user data, and no atlas
 * stores one.
 *
 * @param requestBody the POST body the client sent
 * @returns the declared name, or `null` when the envelope carries none
 */
export function graphqlOperationName({ requestBody }: { requestBody: string | undefined }): string | null {
  if (requestBody === undefined) {
    return null;
  }
  try {
    const envelope: unknown = JSON.parse(requestBody);
    if (envelope !== null && typeof envelope === "object" && "operationName" in envelope) {
      const name = (envelope as { operationName?: unknown }).operationName;
      return typeof name === "string" && name !== "" ? name : null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * One first-party response, reduced to the row this atlas stores, or `null` when it is not one.
 *
 * @param response the captured response
 * @returns the storable row, or `null` for a third party's call
 */
function reducedCall({ response }: { response: CapturedResponse }): InngestObservedCall | null {
  const url = parseUrl({ url: response.url });
  if (url === null || !isInngestHost({ host: url.hostname })) {
    return null;
  }
  const isGraphql = url.pathname === INNGEST_GRAPHQL_PATH;
  const rootFields = isGraphql ? [...resolveRootFields({ requestBody: response.requestBody }).rootFields] : [];
  return {
    fields: responseFieldPaths({ body: response.body, classify: INNGEST_SEGMENTS, depthCap: INNGEST_PATH_DEPTH }),
    host: url.hostname,
    method: response.method.toUpperCase(),
    operationName: isGraphql ? graphqlOperationName({ requestBody: response.requestBody }) : null,
    operationType: isGraphql ? operationTypeOf({ rootFields }) : null,
    pathShape: redactedUrlPath({ pathname: url.pathname }),
    rootFields,
    statusCode: response.statusCode,
  };
}

/**
 * The key two calls must share to be one row.
 *
 * A GraphQL call is keyed on its operation NAME because every operation is posted to the same address, so
 * the path identifies nothing. Everything else is keyed on method, host and path shape.
 *
 * @param row the reduced call
 * @returns the identity two sightings of one call agree on
 */
function callKey({ row }: { row: InngestObservedCall }): string {
  const address = `${row.method} ${row.host}${row.pathShape}`;
  return row.operationType === null
    ? address
    : `${address} ${absentAs({ value: row.operationName, whenAbsent: "(unnamed)" })}`;
}

/**
 * Fold a second sighting of one call onto the first, keeping the union of what each saw.
 *
 * @param held the row already stored under this key, or `undefined` for a first sighting
 * @param row this sighting
 * @returns the merged row
 */
function foldCall({
  held,
  row,
}: {
  held: InngestObservedCall | undefined;
  row: InngestObservedCall;
}): InngestObservedCall {
  if (held === undefined) {
    return row;
  }
  return {
    ...row,
    fields: [...new Set([...held.fields, ...row.fields])].toSorted(),
    rootFields: [...new Set([...held.rootFields, ...row.rootFields])].toSorted(),
  };
}

/**
 * Reduce every first-party response one page caused into storable rows.
 *
 * @param responses the page's captured responses
 * @returns one row per distinct call, sorted, carrying names only
 */
export function reduceInngestCalls({
  responses,
}: {
  responses: readonly CapturedResponse[];
}): readonly InngestObservedCall[] {
  const rows = new Map<string, InngestObservedCall>();
  for (const response of responses) {
    const row = reducedCall({ response });
    if (row !== null) {
      const key = callKey({ row });
      rows.set(key, foldCall({ held: rows.get(key), row }));
    }
  }
  return [...rows.entries()].toSorted(([left], [right]) => left.localeCompare(right)).map(([, row]) => row);
}
