/**
 * Turn what the tenant's own web client asked for into atlas rows — the OPERATION it called and the field
 * NAMES that came back, never a value.
 *
 * ## This file is the redaction, and it is committed so a reviewer can read it rather than trust it
 *
 * A signed-in session sees every application, person and contract this organisation has. The browser
 * channel records what the client can ASK FOR; the entity kinds are ingested through the API channel
 * instead, which is `docs/atlas-intent/07-browser-fallback.md`'s browser-is-the-fallback ruling applied rather than
 * restated. The walk and the redaction pass are `kit/responseShape.ts`, shared with the Slack, Vanta,
 * CrowdStrike and Notion atlases; what is this platform's own is here.
 *
 * ## The path shape is the whole row, because this client names its operation IN the path
 *
 * `POST /AppsApi/CustomerApp/FilterItems` and `POST /AppsApi/AppCatalog/FilterItems` differ only in a
 * middle segment, and they are two completely different lists. So the reduction keeps every non-value
 * segment rather than collapsing to a prefix — a reduction that stored `/AppsApi/{x}/FilterItems` would
 * throw away the distinction the atlas exists to record.
 */
import type { CapturedResponse } from "../../browser/pageTransport.js";
import { responseFieldPaths, type SegmentClassifier } from "../kit/responseShape.js";

/**
 * A provider id ANYWHERE in a path segment: 24 hexadecimal characters, this platform's own object key.
 *
 * Deliberately not anchored, for the reason the Notion reduction records: an anchored test matches nothing
 * when the id is only PART of a segment, and the stored path shape then carries a real value out of the
 * tenant. A segment that CONTAINS an id is a value, whatever else is wrapped around it.
 */
const TRELICA_ID_ANYWHERE = /[0-9a-f]{24}/;

/** A uuid in either the dashed or the bare form, which this platform uses for its account-level keys. */
const UUID_ANYWHERE = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/;

/** A bare run of digits — an epoch, an offset, or a numeric id used as a map key. */
const DIGITS_ONLY = /^[0-9]+$/;

/**
 * This platform's own value-segment shapes, handed to the kit's redaction pass.
 *
 * @returns the placeholder to substitute, or `null` for a segment that is a real path name
 * @internal
 */
export const TRELICA_SEGMENTS: SegmentClassifier = ({ segment }) => {
  const lowered = segment.toLowerCase();
  // No value here is split across two dotted segments, so two adjacent ids are genuinely two ids and
  // collapsing them would understate the shape.
  if (UUID_ANYWHERE.test(lowered)) {
    return { collapsesWithPrevious: false, placeholder: "{uuid}" };
  }
  if (TRELICA_ID_ANYWHERE.test(lowered)) {
    return { collapsesWithPrevious: false, placeholder: "{id}" };
  }
  if (DIGITS_ONLY.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "{n}" };
  }
  return null;
};

/**
 * How deep into a response body the field census walks before it stops.
 * @internal
 */
export const TRELICA_PATH_DEPTH = 2;

/**
 * The most field names one observation keeps.
 *
 * Above the top-level field count of one inventory record, whose every key `firstPartyBoundaries.ts` declares,
 * so a page that renders the inventory does not have its own shape truncated at the point the census becomes interesting.
 *
 * @internal
 */
export const TRELICA_PATH_CAP = 300;

/**
 * The keys whose contents the web client's answers carry and the atlas never names: a run's
 * `baseScope.variables`, a step's request log and credentials, a connection's configuration, a contract's
 * documents. The first-party reads prune these by schema (`trelicaBoundary.ts`); a captured browser body has no
 * schema, so the browser census prunes by NAME and keeps the key itself, never a name beneath it.
 *
 * @internal
 */
export const TRELICA_SECRET_BEARING_KEYS: ReadonlySet<string> = new Set([
  "apiRequestLog",
  "body",
  "clients",
  "credentials",
  "documents",
  "eventLog",
  "externalId",
  "fixedPassword",
  "headers",
  "inputParameterValues",
  "integrationLogMessages",
  "messageBody",
  "method",
  "outputs",
  "parameters",
  "pipelineInputParameters",
  "postConnectFormData",
  "scope",
  "url",
  "variables",
]);

/**
 * A body with every secret-bearing key's contents replaced by `null`, at any depth. Both census channels walk
 * this rather than the raw body: a captured browser body has no schema at all, and a first-party read the
 * boundary census view does not cover — the AI-usage rows — would otherwise be walked raw.
 *
 * @param value the body as it was answered
 * @returns the body with nothing beneath a secret-bearing key
 * @internal
 */
export function trelicaSecretsPruned({ value }: { value: unknown }): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => trelicaSecretsPruned({ value: item }));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => [
      key,
      TRELICA_SECRET_BEARING_KEYS.has(key) ? null : trelicaSecretsPruned({ value: field }),
    ]),
  );
}

/** One call this platform's web client made, reduced to what may be stored. */
export interface TrelicaObservedCall {
  readonly method: string;
  /** The path with every value segment replaced, e.g. `/AppsApi/CustomerApp/FilterItems`. */
  readonly pathShape: string;
  readonly statusCode: number;
  /** Every field name observed in the response body, sorted. Names only, never a value. */
  readonly responseFields: readonly string[];
}

/**
 * Whether a captured response belongs to the tenant itself, rather than the analytics, feature-flag and
 * error-reporting services a page also calls.
 *
 * @param url the response's URL
 * @param tenantOrigin this installation's tenant origin
 * @returns whether this response is the platform's own
 *
 * @internal
 */
export function isTrelicaFirstPartyCall({ url, tenantOrigin }: { url: string; tenantOrigin: string }): boolean {
  try {
    return new URL(url).origin === tenantOrigin;
  } catch {
    return false;
  }
}

/**
 * The path shape of a URL, with every value segment redacted.
 *
 * @param url the response's URL
 * @returns the redacted path shape, or `null` when the URL cannot be read
 *
 * @internal
 */
export function trelicaPathShape({ url }: { url: string }): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const shaped = parsed.pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      // A segment the classifier does not judge a value is a path word, kept as it stands.
      const verdict = TRELICA_SEGMENTS({ segment });
      if (verdict === null) {
        return segment;
      }
      return verdict.placeholder;
    });
  return `/${shaped.join("/")}`;
}

/**
 * Reduce one page's captured responses to the rows the atlas may store.
 *
 * @param responses everything the page's own client asked for while it rendered
 * @param tenantOrigin this installation's tenant origin, so third-party telemetry is dropped at extraction
 *   rather than filtered later
 * @returns one row per distinct first-party call, ordered by method and path so a published file is stable
 */
export function reduceTrelicaCalls({
  responses,
  tenantOrigin,
}: {
  responses: readonly CapturedResponse[];
  tenantOrigin: string;
}): readonly TrelicaObservedCall[] {
  const byKey = new Map<string, { call: TrelicaObservedCall; fields: Set<string> }>();
  for (const response of responses) {
    if (!isTrelicaFirstPartyCall({ tenantOrigin, url: response.url })) {
      continue;
    }
    const pathShape = trelicaPathShape({ url: response.url });
    if (pathShape === null) {
      continue;
    }
    const key = `${response.method.toUpperCase()} ${pathShape}`;
    const fields = responseFieldPaths({
      body: trelicaSecretsPruned({ value: response.body }),
      classify: TRELICA_SEGMENTS,
      depthCap: TRELICA_PATH_DEPTH,
    });
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, {
        call: { method: response.method, pathShape, responseFields: [], statusCode: response.statusCode },
        fields: new Set(fields),
      });
      continue;
    }
    for (const field of fields) {
      existing.fields.add(field);
    }
  }
  return [...byKey.values()]
    .map(({ call, fields }): TrelicaObservedCall => ({
      ...call,
      responseFields: [...fields].toSorted().slice(0, TRELICA_PATH_CAP),
    }))
    .toSorted((left, right) => `${left.method} ${left.pathShape}`.localeCompare(`${right.method} ${right.pathShape}`));
}
