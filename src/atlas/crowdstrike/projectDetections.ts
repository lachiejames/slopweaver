/**
 * The Falcon Alerts projection: `detection`.
 *
 * Alone in its own module because it is the one entity whose deep link Falcon hands back rather than this
 * code assembling one — `falcon_host_link` — so it is the only API projection that calls
 * {@link crowdstrikeSource} directly instead of taking the envelope's.
 */

import { err, type Result } from "../../lib/result.js";
import type { CrowdstrikeDetection } from "./entities.js";
import { crowdstrikeDetectionSchema } from "./entities.js";
import {
  crowdstrikeSource,
  envelope,
  type ProjectionContext,
  requireProviderId,
  validate,
} from "./projectionEnvelope.js";
import { firstOf, readIso, readNumber, readObject, readString } from "./projectionReaders.js";

/**
 * Project one detection.
 *
 * The only projection that records a deep link, and the link is the provider's own `falcon_host_link` —
 * never a console URL assembled from ids, which would read as provenance while being this code's guess.
 *
 * @param raw the `/alerts/entities/alerts/v2` resource
 * @param context this run's instant and provenance
 * @returns the storable detection, or why it could not be built
 */
export function projectCrowdstrikeDetection({
  raw,
  context,
}: {
  raw: unknown;
  context: ProjectionContext;
}): Result<CrowdstrikeDetection> {
  const providerId = requireProviderId({ field: "composite_id", kind: "detection", raw });
  if (providerId.isErr()) {
    return err(providerId.error);
  }
  const device = readObject({ field: "device", raw });
  const link = readString({ field: "falcon_host_link", raw });
  const candidate = {
    ...envelope({ context, kind: "detection", providerId: providerId.value }),
    confidence: readNumber({ field: "confidence", raw }),
    createdAt: readIso({ field: "created_timestamp", raw }),
    displayName: readString({ field: "display_name", raw }),
    hostAid: firstOf({
      values: [readString({ field: "agent_id", raw }), readString({ field: "device_id", raw: device })],
    }),
    hostname: readString({ field: "hostname", raw: device }),
    objective: readString({ field: "objective", raw }),
    patternDispositionDescription: readString({ field: "pattern_disposition_description", raw }),
    preventionPolicyId: readString({ field: "prevention_policy_id", raw }),
    product: readString({ field: "product", raw }),
    severity: readNumber({ field: "severity", raw }),
    severityName: readString({ field: "severity_name", raw }),
    source: crowdstrikeSource({ input: { ...context.source, deepLink: link } }),
    status: readString({ field: "status", raw }),
    tactic: readString({ field: "tactic", raw }),
    technique: readString({ field: "technique", raw }),
    updatedAt: readIso({ field: "updated_timestamp", raw }),
  };
  return validate({ candidate, kind: "detection", schema: crowdstrikeDetectionSchema });
}
