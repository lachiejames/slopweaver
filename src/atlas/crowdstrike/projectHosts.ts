/**
 * The Falcon Devices API projections: `host` and `host-group`.
 *
 * One family because they come from one set of calls — `CROWDSTRIKE_CALLS` in {@link ./inventory} files
 * both under those two kinds, and a host carries its groups' ids while a group carries nothing of the
 * host. A host's policies and login history are nested reads off the same payload, which is why
 * {@link devicePolicy} lives here and nowhere else.
 */

import { err, type Result } from "../../lib/result.js";
import type { CrowdstrikeHost, CrowdstrikeHostGroup } from "./entities.js";
import { crowdstrikeHostGroupSchema, crowdstrikeHostSchema } from "./entities.js";
import { envelope, type ProjectionContext, requireProviderId, validate } from "./projectionEnvelope.js";
import {
  firstOf,
  readBoolean,
  readField,
  readIso,
  readObject,
  readString,
  readStringArray,
  readStringOr,
} from "./projectionReaders.js";

/** One device policy's attachment, as `device_policies.<name>` reports it. */
function devicePolicy({ raw, name }: { raw: unknown; name: string }): { applied: boolean | null; id: string | null } {
  const policies = readObject({ field: "device_policies", raw });
  const policy = readObject({ field: name, raw: policies });
  return {
    applied: readBoolean({ field: "applied", raw: policy }),
    id: readString({ field: "policy_id", raw: policy }),
  };
}

/**
 * Project one host, folding in whatever the enrichment calls returned for it.
 *
 * The enrichments arrive as separate responses keyed by the same agent id, so they are passed in rather
 * than fetched here — this stays pure, and a host whose enrichment call failed still projects with those
 * fields null rather than failing the whole kind.
 *
 * @param raw the `/devices/entities/devices/v2` resource
 * @param hidden whether this id came from the hidden-device query rather than the visible one
 * @param onlineState the `/devices/entities/online-state/v1` resource for the same id, when one was read
 * @param loginHistory the login-history resource for the same id, when one was read
 * @param context this run's instant and provenance
 * @returns the storable host, or why it could not be built
 */
export function projectCrowdstrikeHost({
  raw,
  hidden,
  onlineState,
  loginHistory,
  context,
}: {
  raw: unknown;
  hidden: boolean;
  onlineState: unknown;
  loginHistory: unknown;
  context: ProjectionContext;
}): Result<CrowdstrikeHost> {
  const providerId = requireProviderId({ field: "device_id", kind: "host", raw });
  if (providerId.isErr()) {
    return err(providerId.error);
  }
  const prevention = devicePolicy({ name: "prevention", raw });
  const sensorUpdate = devicePolicy({ name: "sensor_update", raw });
  const logins = readField({ field: "recent_logins", raw: loginHistory });
  const mostRecent = Array.isArray(logins) ? logins[0] : null;
  const candidate = {
    ...envelope({ context, kind: "host", providerId: providerId.value }),
    agentVersion: readString({ field: "agent_version", raw }),
    firstSeenAtProvider: readIso({ field: "first_seen", raw }),
    groupIds: readStringArray({ field: "groups", raw }),
    hidden,
    hostname: readString({ field: "hostname", raw }),
    kernelVersion: readString({ field: "kernel_version", raw }),
    lastLoginAccount: firstOf({
      values: [readString({ field: "user_name", raw: mostRecent }), readString({ field: "last_login_user", raw })],
    }),
    lastLoginAt: firstOf({
      values: [readIso({ field: "login_time", raw: mostRecent }), readIso({ field: "last_login_timestamp", raw })],
    }),
    lastSeenAt: readIso({ field: "last_seen", raw }),
    macAddress: readString({ field: "mac_address", raw }),
    onlineState: readString({ field: "state", raw: onlineState }),
    osBuild: readString({ field: "os_build", raw }),
    osVersion: readString({ field: "os_version", raw }),
    platformName: readString({ field: "platform_name", raw }),
    preventionPolicyApplied: prevention.applied,
    preventionPolicyId: prevention.id,
    productTypeDesc: readString({ field: "product_type_desc", raw }),
    reducedFunctionalityMode: readString({ field: "reduced_functionality_mode", raw }),
    rtrState: readString({ field: "rtr_state", raw }),
    sensorUpdatePolicyApplied: sensorUpdate.applied,
    sensorUpdatePolicyId: sensorUpdate.id,
    serialNumber: readString({ field: "serial_number", raw }),
    status: readString({ field: "status", raw }),
    systemManufacturer: readString({ field: "system_manufacturer", raw }),
    systemProductName: readString({ field: "system_product_name", raw }),
  };
  return validate({ candidate, kind: "host", schema: crowdstrikeHostSchema });
}

/**
 * Project one host group.
 *
 * @param raw the `/devices/entities/host-groups/v1` resource
 * @param context this run's instant and provenance
 * @returns the storable host group, or why it could not be built
 */
export function projectCrowdstrikeHostGroup({
  raw,
  context,
}: {
  raw: unknown;
  context: ProjectionContext;
}): Result<CrowdstrikeHostGroup> {
  const providerId = requireProviderId({ field: "id", kind: "host-group", raw });
  if (providerId.isErr()) {
    return err(providerId.error);
  }
  const candidate = {
    ...envelope({ context, kind: "host-group", providerId: providerId.value }),
    createdAt: readIso({ field: "created_timestamp", raw }),
    description: readString({ field: "description", raw }),
    groupType: readString({ field: "group_type", raw }),
    modifiedAt: readIso({ field: "modified_timestamp", raw }),
    name: readStringOr({ field: "name", raw, substitute: providerId.value }),
  };
  return validate({ candidate, kind: "host-group", schema: crowdstrikeHostGroupSchema });
}
