/**
 * The browser-walk projections: `console-page` and `console-request`.
 *
 * **These reach none of {@link ./projectionReaders}, and that absence is the point.** Every other
 * projection parses raw provider JSON through {@link readField}, which is the sole consultation point for
 * `privacy.ts`. A console projection's input is an already-typed observation the walk handed over, so
 * there is no raw field here to allow or deny and no reader import by which one could be added — a record
 * from this module cannot imply an allowlist check that never ran.
 *
 * What they do share is the envelope, so a console-discovered record is identified, stamped and validated
 * exactly like an API one, and its provenance says `browser-discovered` rather than `provider-provided`.
 */

import type { Result } from "../../lib/result.js";
import type { AtlasArtifactRef } from "../kit/contract.js";
import type { CrowdstrikeConsolePage, CrowdstrikeConsoleRequest } from "./entities.js";
import { crowdstrikeConsolePageSchema, crowdstrikeConsoleRequestSchema } from "./entities.js";
import { crowdstrikeSource, envelope, type ProjectionContext, validate } from "./projectionEnvelope.js";

/** What the console walk observed about one declared page. */
export interface ConsolePageObservation {
  readonly href: string;
  readonly appName: string | null;
  readonly featureFlags: readonly string[];
  readonly permissions: readonly string[];
  readonly finalUrl: string | null;
  readonly outcome: CrowdstrikeConsolePage["outcome"];
  readonly statusCode: number | null;
  readonly title: string | null;
  readonly artifacts: readonly AtlasArtifactRef[];
}

/**
 * Project one console page the walk visited, or declined to visit.
 *
 * @param observation what the walk saw
 * @param context this run's instant and provenance
 * @returns the storable page, or why it could not be built
 */
export function projectCrowdstrikeConsolePage({
  observation,
  context,
}: {
  observation: ConsolePageObservation;
  context: ProjectionContext;
}): Result<CrowdstrikeConsolePage> {
  const candidate = {
    ...envelope({ context, kind: "console-page", providerId: observation.href }),
    appName: observation.appName,
    featureFlags: [...observation.featureFlags],
    finalUrl: observation.finalUrl,
    href: observation.href,
    outcome: observation.outcome,
    permissions: [...observation.permissions],
    source: crowdstrikeSource({
      input: {
        ...context.source,
        artifacts: observation.artifacts,
        deepLink: observation.outcome === "landed" ? observation.finalUrl : null,
      },
    }),
    statusCode: observation.statusCode,
    title: observation.title,
  };
  return validate({
    candidate,
    kind: "console-page",
    schema: crowdstrikeConsolePageSchema,
  });
}

/** One reduced first-party call, as the walk accumulated it across every page it appeared on. */
export interface ConsoleRequestObservation {
  readonly pathShape: string;
  readonly method: string;
  readonly paramNames: readonly string[];
  readonly responseFieldPaths: readonly string[];
  readonly statusCodes: readonly number[];
  readonly observedOnPages: readonly string[];
}

/**
 * Project one call the console made.
 *
 * `callability` is written as a literal rather than derived, because there is exactly one honest value for
 * a browser observation and the field exists so a reader cannot mistake it for something this installation
 * can invoke.
 *
 * @param observation the reduced call
 * @param context this run's instant and provenance
 * @returns the storable request, or why it could not be built
 */
export function projectCrowdstrikeConsoleRequest({
  observation,
  context,
}: {
  observation: ConsoleRequestObservation;
  context: ProjectionContext;
}): Result<CrowdstrikeConsoleRequest> {
  const candidate = {
    ...envelope({
      context,
      kind: "console-request",
      providerId: `${observation.method} ${observation.pathShape}`,
    }),
    callability: "browser-observed-only",
    method: observation.method,
    observedOnPages: [...observation.observedOnPages].toSorted(),
    paramNames: [...observation.paramNames].toSorted(),
    pathShape: observation.pathShape,
    responseFieldPaths: [...observation.responseFieldPaths].toSorted(),
    statusCodes: [...new Set(observation.statusCodes)].toSorted((left, right) => left - right),
  };
  return validate({
    candidate,
    kind: "console-request",
    schema: crowdstrikeConsoleRequestSchema,
  });
}
