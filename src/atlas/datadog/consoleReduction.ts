/**
 * Turn what the Datadog console asked for into atlas rows — the endpoint it called and the field NAMES that
 * came back, never a value — and say which registry operation each call corroborates.
 *
 * ## This file is the redaction, and it is committed so a reviewer can read it rather than trust it
 *
 * A signed-in console session sees log lines, RUM sessions, the organisation's users and every monitor's
 * query. The console channel records what the console can ASK FOR, never what this organisation contains,
 * so the reduction is a thing a reviewer reads once, here. The redaction pass is `kit/responseShape.ts` and
 * the accumulation is `kit/consoleFold.ts`, both shared with the sibling atlases; what is Datadog's own is
 * which path segments are VALUES, which parameter names are session material, and where to cap.
 *
 * ## Datadog addresses things four ways, and the classifier names each
 *
 * A dashboard is `abc-def-ghi` (three groups of three, lower-case alphanumerics), a monitor or notebook is
 * a bare integer, an organisation, a team or an incident is a uuid, and a synthetics test or an API key is
 * an opaque token. Each becomes its own placeholder so `GET /api/v1/dashboard/<dashboard>` and
 * `GET /api/v1/monitor/<id>` read as what they are, and so a run of digits — an id here far more often
 * than a path name — never survives into a committed shape.
 *
 * ## Corroboration is by path SHAPE against the registry's own templates
 *
 * The compiled catalogue's entities are operations (`catalogue.ts`), so what the console channel of one
 * means is "the console itself called this". {@link registryOperationFor} normalises a registry template
 * (`/api/v1/dashboard/{dashboard_id}`) and an observed shape (`/api/v1/dashboard/<dashboard>`) to the same
 * placeholder and matches on method plus path. A `/api/ui/…` call matches nothing and is recorded as a
 * `console-request` alone — that is the half of the console the SDK does not declare, and it is the half
 * the earlier recon was run to find.
 */
import { type ConsoleFoldSpec, foldConsoleCalls, type ObservedCall } from "../kit/consoleFold.js";
import type { SegmentClassifier } from "../kit/responseShape.js";

import { DATADOG_SURFACES } from "./generated/surfaces.js";
import type { DatadogSurfaceRow } from "./surfaceRow.js";

/** A uuid: an organisation, a team, an incident, a case. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A dashboard id, as in `/api/v1/dashboard/abc-def-ghi`. */
const DASHBOARD_ID = /^[a-z0-9]{3}-[a-z0-9]{3}-[a-z0-9]{3}$/;

/** A bare run of digits: a monitor, a notebook, an SLO, a user, a downtime. */
const DIGITS_ONLY = /^[0-9]+$/;

/** A long opaque token: a synthetics public id, an API key id, a session-scoped handle. */
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{24,}$/;

/**
 * Datadog's own value-segment shapes, handed to the kit's redaction pass.
 *
 * None collapses with its neighbour: no Datadog id is split across two dotted segments.
 *
 * @param segment one dot-separated path segment
 * @returns how to redact it, or `null` when it is a genuine field name
 */
export const DATADOG_SEGMENTS: SegmentClassifier = ({ segment }) => {
  if (UUID.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "<uuid>" };
  }
  if (DASHBOARD_ID.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "<dashboard>" };
  }
  if (DIGITS_ONLY.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "<id>" };
  }
  return OPAQUE_TOKEN.test(segment) ? { collapsesWithPrevious: false, placeholder: "<token>" } : null;
};

/**
 * Query parameters dropped before a request is recorded.
 *
 * Everything beginning with an underscore is the client's own cache-busting and analytics bundle; the
 * named entries are session material or a wall-clock stamp. A parameter NAME says what an endpoint
 * accepts; these say what this session was, which is the thing the atlas must not keep.
 *
 * @internal
 */
export const DATADOG_TELEMETRY_PARAM =
  /^(?:_|cb$|t$|ts$|timestamp$|token$|access_token$|csrf|nonce$|session_id$|sid$)/i;

/**
 * How deep a response path is kept: a field on an object inside a list inside Datadog's JSON:API envelope,
 * which is `data.attributes.<list>[].<field>` — five levels, one more than the siblings, because MEASURED,
 * the palette's `data.attributes.entities[]` stopped at the list under a cap of four and the
 * entity's own fields were never recorded.
 *
 * @internal
 */
export const DATADOG_PATH_DEPTH = 5;

/**
 * The most response paths one recorded call retains — a bound, because the console's feature-flag and
 * preference documents carry a path per flag and preference this organisation has configured, so their
 * path count grows with that configuration rather than with the response's shape.
 *
 * @internal
 */
export const DATADOG_PATH_CAP = 400;

/**
 * One first-party call the walk observed on one page.
 *
 * @internal
 */
export type ObservedConsoleCall = ObservedCall;

/** The four platform-specific values the kit's fold cannot decide for Datadog. */
const DATADOG_FOLD_SPEC: ConsoleFoldSpec = {
  classify: DATADOG_SEGMENTS,
  depthCap: DATADOG_PATH_DEPTH,
  pathCap: DATADOG_PATH_CAP,
  telemetryParam: DATADOG_TELEMETRY_PARAM,
};

/** What one observed console call yields, before it becomes an entity. */
export interface ConsoleRequestObservation {
  readonly method: string;
  readonly pathShape: string;
  readonly paramNames: readonly string[];
  readonly responseFieldPaths: readonly string[];
  readonly statusCodes: readonly number[];
  readonly observedOnPages: readonly string[];
  /** The registry row this call corroborates, or `null` when the SDK declares nothing at this path. */
  readonly registry: DatadogSurfaceRow | null;
}

/**
 * Fold every call a whole walk observed into one row per distinct endpoint, each matched to the registry.
 *
 * @param calls every call the walk observed, from every page
 * @returns one observation per distinct method-and-path-shape, sorted
 */
export function reduceDatadogConsoleCalls({
  calls,
}: {
  calls: readonly ObservedConsoleCall[];
}): readonly ConsoleRequestObservation[] {
  return foldConsoleCalls({ calls, spec: DATADOG_FOLD_SPEC }).map((folded) => ({
    ...folded,
    registry: registryOperationFor({ method: folded.method, pathShape: folded.pathShape }),
  }));
}

/** Every placeholder either side can carry, reduced to one so a template and a shape compare equal. */
const ANY_PLACEHOLDER = /\{[^}]+\}|<[a-z]+>/g;

/** A registry template or an observed shape with every parameter collapsed to one marker. */
function comparablePath({ path }: { path: string }): string {
  return path.replace(ANY_PLACEHOLDER, "*");
}

/** The registry indexed by `METHOD comparable-path`, built once. */
let registryIndex: ReadonlyMap<string, DatadogSurfaceRow> | null = null;

function registryByComparablePath(): ReadonlyMap<string, DatadogSurfaceRow> {
  if (registryIndex !== null) {
    return registryIndex;
  }
  const index = new Map<string, DatadogSurfaceRow>();
  for (const row of DATADOG_SURFACES) {
    const key = `${row.method} ${comparablePath({ path: row.path })}`;
    // A template can appear under both specs (`/api/v1/dashboard/{dashboard_id}` is one row per method);
    // the first in registry order is kept, and either would name the same kind.
    if (!index.has(key)) {
      index.set(key, row);
    }
  }
  registryIndex = index;
  return index;
}

/**
 * The registry operation an observed console call corroborates, if the pinned SDK declares one there.
 *
 * @param method the request method
 * @param pathShape the redacted path shape the fold produced
 * @returns the matching row, or `null` when the SDK declares nothing at that method and path
 */
export function registryOperationFor({
  method,
  pathShape,
}: {
  method: string;
  pathShape: string;
}): DatadogSurfaceRow | null {
  // `?? null` and `x === undefined ? null : x` are each refused by one of the two style gates; a `Map`
  // miss is `undefined` and this contract answers `null`, so the substitution is written as a statement.
  const row = registryByComparablePath().get(`${method.toUpperCase()} ${comparablePath({ path: pathShape })}`);
  if (row === undefined) {
    return null;
  }
  return row;
}
