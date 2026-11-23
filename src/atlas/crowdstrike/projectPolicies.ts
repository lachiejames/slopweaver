/**
 * The Falcon Policies API projections: `prevention-policy` and `sensor-update-policy`.
 *
 * One function projects both kinds, because Falcon returns them on parallel endpoints with one shape
 * differing only in how settings are spelled — prevention nests them under named categories, sensor-update
 * returns one flat object. Both are flattened into the same addressable list so a stored policy can be
 * diffed against another of either kind.
 */

import { err, type Result } from "../../lib/result.js";
import type { CrowdstrikePolicy } from "./entities.js";
import { crowdstrikePolicySchema } from "./entities.js";
import { isDeniedCrowdstrikeField } from "./privacy.js";
import { envelope, type ProjectionContext, requireProviderId, validate } from "./projectionEnvelope.js";
import {
  isRecord,
  readBooleanOr,
  readField,
  readIso,
  readObject,
  readString,
  readStringOr,
} from "./projectionReaders.js";

/**
 * The `id` of every entry in a provider array, deduplicated and sorted.
 *
 * @param entries the raw array, whose entries may be strings or objects
 * @returns the ids found, in stable order
 */
function readIdsOf({ entries }: { entries: readonly unknown[] }): readonly string[] {
  const ids = entries.flatMap((entry) => {
    if (typeof entry === "string" && entry.trim().length > 0) {
      return [entry.trim()];
    }
    const id = readString({ field: "id", raw: entry });
    return id === null ? [] : [id];
  });
  return [...new Set(ids)].toSorted();
}

/** Flatten a prevention policy's two-level settings tree into one addressable list. */
function preventionSettings({
  raw,
}: {
  raw: unknown;
}): readonly { category: string; id: string; name: string; value: string }[] {
  const categories = readField({ field: "prevention_settings", raw });
  if (!Array.isArray(categories)) {
    return [];
  }
  return categories.flatMap((category): readonly { category: string; id: string; name: string; value: string }[] => {
    // A settings group Falcon returns without a name still carries real settings, so it is filed under an
    // honest label rather than dropped or given a blank one.
    const categoryName = readStringOr({ field: "name", raw: category, substitute: "unnamed group" });
    const settings = readField({ field: "settings", raw: category });
    if (!Array.isArray(settings)) {
      return [];
    }
    return settings.flatMap((setting) => {
      const id = readString({ field: "id", raw: setting });
      if (id === null) {
        return [];
      }
      return [
        {
          category: categoryName,
          id,
          name: readStringOr({ field: "name", raw: setting, substitute: id }),
          value: JSON.stringify(readField({ field: "value", raw: setting })),
        },
      ];
    });
  });
}

/** Flatten a sensor-update policy's flat settings object into the same addressable list. */
function sensorUpdateSettings({
  raw,
}: {
  raw: unknown;
}): readonly { category: string; id: string; name: string; value: string }[] {
  const settings = readObject({ field: "settings", raw });
  if (settings === null || !isRecord(settings)) {
    return [];
  }
  return Object.keys(settings)
    .toSorted()
    .flatMap((key) => {
      if (isDeniedCrowdstrikeField({ field: key })) {
        return [];
      }
      return [{ category: "settings", id: key, name: key, value: JSON.stringify(settings[key]) }];
    });
}

/**
 * Project one prevention or sensor-update policy.
 *
 * The two share a schema because they share every field a question is asked about — name, whether it is
 * enabled, which groups it covers, and its settings. Only the settings SHAPE differs, and that difference
 * is absorbed by flattening both into one addressable list rather than by forking the kind.
 *
 * @param raw the policy resource
 * @param kind which policy kind this is, which decides how the settings are flattened
 * @param context this run's instant and provenance
 * @returns the storable policy, or why it could not be built
 */
export function projectCrowdstrikePolicy({
  raw,
  kind,
  context,
}: {
  raw: unknown;
  kind: "prevention-policy" | "sensor-update-policy";
  context: ProjectionContext;
}): Result<CrowdstrikePolicy> {
  const providerId = requireProviderId({ field: "id", kind, raw });
  if (providerId.isErr()) {
    return err(providerId.error);
  }
  const groups = readField({ field: "groups", raw });
  const groupIds = Array.isArray(groups) ? readIdsOf({ entries: groups }) : [];
  const candidate = {
    ...envelope({ context, kind, providerId: providerId.value }),
    createdAt: readIso({ field: "created_timestamp", raw }),
    description: readString({ field: "description", raw }),
    enabled: readBooleanOr({ field: "enabled", raw, substitute: false }),
    groupIds,
    modifiedAt: readIso({ field: "modified_timestamp", raw }),
    name: readStringOr({ field: "name", raw, substitute: providerId.value }),
    platformName: readString({ field: "platform_name", raw }),
    settings: kind === "prevention-policy" ? preventionSettings({ raw }) : sensorUpdateSettings({ raw }),
  };
  return validate({ candidate, kind, schema: crowdstrikePolicySchema });
}
