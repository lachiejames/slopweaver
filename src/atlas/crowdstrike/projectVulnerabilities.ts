/**
 * The Falcon Spotlight projection: `vulnerability`.
 *
 * A vulnerability record is mostly nested — the CVE's own fields, the CISA KEV flag and the remediation
 * all arrive under their own objects — so this reads wider than it reads deep.
 */

import { err, type Result } from "../../lib/result.js";
import type { CrowdstrikeVulnerability } from "./entities.js";
import { crowdstrikeVulnerabilitySchema } from "./entities.js";
import { envelope, type ProjectionContext, requireProviderId, validate } from "./projectionEnvelope.js";
import {
  readBoolean,
  readField,
  readIso,
  readNumber,
  readObject,
  readString,
  readStringOr,
} from "./projectionReaders.js";

/**
 * Project one Spotlight vulnerability.
 *
 * @param raw the `/spotlight/combined/vulnerabilities/v1` resource, read with the `cve` facet
 * @param context this run's instant and provenance
 * @returns the storable vulnerability, or why it could not be built
 */
export function projectCrowdstrikeVulnerability({
  raw,
  context,
}: {
  raw: unknown;
  context: ProjectionContext;
}): Result<CrowdstrikeVulnerability> {
  const providerId = requireProviderId({ field: "id", kind: "vulnerability", raw });
  if (providerId.isErr()) {
    return err(providerId.error);
  }
  const cve = readObject({ field: "cve", raw });
  const cisa = readObject({ field: "cisa_info", raw: cve });
  const apps = readField({ field: "apps", raw });
  const candidate = {
    ...envelope({ context, kind: "vulnerability", providerId: providerId.value }),
    apps: Array.isArray(apps)
      ? apps.flatMap((app) => {
          const product = readString({ field: "product_name_version", raw: app });
          if (product === null) {
            return [];
          }
          return [
            {
              productNameVersion: product,
              subStatus: readString({ field: "sub_status", raw: app }),
              vendorNormalized: readString({ field: "vendor_normalized", raw: app }),
            },
          ];
        })
      : [],
    baseScore: readNumber({ field: "base_score", raw: cve }),
    createdAt: readIso({ field: "created_timestamp", raw }),
    cveId: readString({ field: "id", raw: cve }),
    exploitStatus: readNumber({ field: "exploit_status", raw: cve }),
    exprtRating: readString({ field: "exprt_rating", raw: cve }),
    hostAid: readString({ field: "aid", raw }),
    isCisaKev: readBoolean({ field: "is_cisa_kev", raw: cisa }),
    severity: readString({ field: "severity", raw: cve }),
    status: readStringOr({ field: "status", raw, substitute: "unknown" }),
    updatedAt: readIso({ field: "updated_timestamp", raw }),
  };
  return validate({ candidate, kind: "vulnerability", schema: crowdstrikeVulnerabilitySchema });
}
