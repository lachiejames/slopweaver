/**
 * The Falcon Zero Trust Assessment projections: `zero-trust-assessment` and `zero-trust-audit`.
 *
 * One family because the audit is the assessment's own explanation: an assessment carries a host's scores,
 * an audit carries the per-control findings those scores were computed from, and neither is readable
 * without the other.
 */

import { err, type Result } from "../../lib/result.js";
import type { CrowdstrikeZeroTrustAssessment, CrowdstrikeZeroTrustAudit } from "./entities.js";
import { crowdstrikeZeroTrustAssessmentSchema, crowdstrikeZeroTrustAuditSchema } from "./entities.js";
import { envelope, type ProjectionContext, requireProviderId, validate } from "./projectionEnvelope.js";
import { readField, readIso, readNumber, readObject, readString } from "./projectionReaders.js";

/**
 * Project one Zero Trust Assessment.
 *
 * @param raw the `/zero-trust-assessment/entities/assessments/v1` resource
 * @param context this run's instant and provenance
 * @returns the storable assessment, or why it could not be built
 */
export function projectCrowdstrikeZeroTrustAssessment({
  raw,
  context,
}: {
  raw: unknown;
  context: ProjectionContext;
}): Result<CrowdstrikeZeroTrustAssessment> {
  const providerId = requireProviderId({ field: "aid", kind: "zero-trust-assessment", raw });
  if (providerId.isErr()) {
    return err(providerId.error);
  }
  const assessment = readObject({ field: "assessment", raw });
  const candidate = {
    ...envelope({ context, kind: "zero-trust-assessment", providerId: providerId.value }),
    hostAid: providerId.value,
    modifiedAt: readIso({ field: "modified_time", raw }),
    osSignalsScore: readNumber({ field: "os", raw: assessment }),
    overallScore: readNumber({ field: "overall", raw: assessment }),
    productTypeDesc: readString({ field: "product_type_desc", raw }),
    sensorConfigScore: readNumber({ field: "sensor_config", raw: assessment }),
    sensorFileStatus: readString({ field: "sensor_file_status", raw }),
    serialNumber: readString({ field: "system_serial_number", raw }),
    version: readString({ field: "version", raw: assessment }),
  };
  return validate({
    candidate,
    kind: "zero-trust-assessment",
    schema: crowdstrikeZeroTrustAssessmentSchema,
  });
}

/**
 * Project the tenant-wide Zero Trust summary.
 *
 * Its provider id is the tenant's own `cid`, because the document is a singleton and an id derived from a
 * run would make every sync produce a new entity rather than merging onto the one that exists.
 *
 * @param raw the `/zero-trust-assessment/entities/audit/v1` resource
 * @param context this run's instant and provenance
 * @returns the storable audit, or why it could not be built
 */
export function projectCrowdstrikeZeroTrustAudit({
  raw,
  context,
}: {
  raw: unknown;
  context: ProjectionContext;
}): Result<CrowdstrikeZeroTrustAudit> {
  const providerId = requireProviderId({ field: "cid", kind: "zero-trust-audit", raw });
  if (providerId.isErr()) {
    return err(providerId.error);
  }
  const platforms = readField({ field: "platforms", raw });
  const candidate = {
    ...envelope({ context, kind: "zero-trust-audit", providerId: providerId.value }),
    assessedHostCount: readNumber({ field: "num_aids", raw }),
    averageOverallScore: readNumber({ field: "average_overall_score", raw }),
    platforms: Array.isArray(platforms)
      ? platforms
          .flatMap((platform) => {
            const name = readString({ field: "name", raw: platform });
            if (name === null) {
              return [];
            }
            return [
              {
                assessedHostCount: readNumber({ field: "num_aids", raw: platform }),
                averageOverallScore: readNumber({ field: "average_overall_score", raw: platform }),
                name,
              },
            ];
          })
          .toSorted((left, right) => left.name.localeCompare(right.name))
      : [],
  };
  return validate({
    candidate,
    kind: "zero-trust-audit",
    schema: crowdstrikeZeroTrustAuditSchema,
  });
}
