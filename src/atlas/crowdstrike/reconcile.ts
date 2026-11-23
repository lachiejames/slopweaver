/**
 * Where the two surfaces disagree, and where CrowdStrike disagrees with another fleet source.
 *
 * This is an OUTPUT of the atlas rather than a check on it. The owner's ruling is that when two surfaces
 * disagree the atlas records the disagreement instead of picking a winner — you cannot always code your way
 * out of it, because sometimes the vendor is simply like that, and VISIBILITY over the gotcha is the
 * product. Which surface wins is the owner's call, reserved until real instances are visible; what this
 * module produces is the instances.
 *
 * ## "Last observed login" is not "holder", and this module never conflates them
 *
 * Falcon reports the account it last SAW log in on a machine. An MDM or directory reports who a device is
 * ASSIGNED to. Those are different claims about different facts, and a report that printed one under the
 * other's name would manufacture agreement where none was established. Every field here says which it is,
 * and a mismatch between them is reported as a disagreement to look at rather than as an error.
 *
 * ## The join runs on hardware identity, in a fixed order
 *
 * Serial number first, then hostname, then MAC. Serial is the only one of the three a person cannot change
 * and a re-image does not move; a hostname is renamed; a MAC belongs to an adapter rather than to a
 * machine, and a dock or a VPN adapter gives one device several. So a MAC match alone is reported with its
 * weaker basis stated rather than presented as the same fact as a serial match.
 */
import type { CrowdstrikeHost } from "./entities.js";

/**
 * How two records were matched, weakest last — the basis is reported, never hidden.
 *
 * @internal
 */
export const CROWDSTRIKE_JOIN_KEYS = ["serial-number", "hostname", "mac-address"] as const;

/** @internal */
export type CrowdstrikeJoinKey = (typeof CROWDSTRIKE_JOIN_KEYS)[number];

/** One device as another source describes it, in the smallest shape a join needs. */
export interface ForeignDevice {
  /** That source's own id, so a reader can go and look at the record. */
  readonly providerId: string;
  readonly serialNumber: string | null;
  readonly hostname: string | null;
  readonly macAddress: string | null;
  /** Who that source says the device is ASSIGNED to — a different claim from a last-observed login. */
  readonly assignedTo: string | null;
}

/**
 * One machine both sources describe, and what they disagree about.
 *
 * @internal
 */
export interface FleetMatch {
  readonly crowdstrikeProviderId: string;
  readonly foreignProviderId: string;
  readonly joinedOn: CrowdstrikeJoinKey;
  /** The account Falcon last OBSERVED logging in. Never presented as an assignment. */
  readonly lastObservedLogin: string | null;
  /** Who the other source says the device is ASSIGNED to. */
  readonly assignedTo: string | null;
  /** Fields the two sources describe differently. Empty when they agree on everything compared. */
  readonly disagreements: readonly string[];
}

/**
 * What a whole reconciliation established.
 *
 * @internal
 */
export interface FleetReconciliation {
  readonly matched: readonly FleetMatch[];
  /** Machines with a Falcon sensor that the other source does not list at all. */
  readonly onlyInCrowdstrike: readonly string[];
  /** Machines the other source lists that carry no Falcon sensor — the sensor-coverage gap. */
  readonly onlyInForeign: readonly string[];
  /** Falcon hosts carrying none of the three join keys, so they could never have been matched. */
  readonly unjoinable: readonly string[];
}

/** Normalise a join value: case and separators differ between sources for the same physical fact. */
function joinValue({ raw }: { raw: string | null }): string | null {
  if (raw === null) {
    return null;
  }
  const normalised = raw
    .trim()
    .toLowerCase()
    .replaceAll(/[\s:-]/gu, "");
  return normalised.length === 0 ? null : normalised;
}

/** Every join key one record offers, in preference order. */
function joinKeysOf({
  record,
}: {
  record: { serialNumber: string | null; hostname: string | null; macAddress: string | null };
}): readonly { key: CrowdstrikeJoinKey; value: string }[] {
  const candidates: readonly { key: CrowdstrikeJoinKey; raw: string | null }[] = [
    { key: "serial-number", raw: record.serialNumber },
    { key: "hostname", raw: record.hostname },
    { key: "mac-address", raw: record.macAddress },
  ];
  return candidates.flatMap((candidate) => {
    const value = joinValue({ raw: candidate.raw });
    return value === null ? [] : [{ key: candidate.key, value }];
  });
}

/** Index the foreign fleet by every key it offers, so a lookup is one pass rather than a scan per host. */
function indexForeign({ devices }: { devices: readonly ForeignDevice[] }): Map<string, ForeignDevice> {
  const index = new Map<string, ForeignDevice>();
  for (const device of devices) {
    for (const { key, value } of joinKeysOf({ record: device })) {
      const composite = `${key}:${value}`;
      // First writer wins, so a duplicate in the foreign source cannot silently reassign an earlier match.
      if (!index.has(composite)) {
        index.set(composite, device);
      }
    }
  }
  return index;
}

/**
 * Compare one matched pair, naming what the two sources say differently.
 *
 * Only the fields both sources genuinely describe are compared. A field one side does not carry is not a
 * disagreement — it is an absence, and reporting it as a conflict would bury the real ones.
 *
 * @param host the Falcon host
 * @param device the foreign record
 * @returns the field names the two describe differently
 */
export function fleetDisagreements({
  host,
  device,
}: {
  host: CrowdstrikeHost;
  device: ForeignDevice;
}): readonly string[] {
  const differing: string[] = [];
  for (const [field, left, right] of [
    ["hostname", host.hostname, device.hostname],
    ["serialNumber", host.serialNumber, device.serialNumber],
    ["macAddress", host.macAddress, device.macAddress],
  ] as const) {
    const a = joinValue({ raw: left });
    const b = joinValue({ raw: right });
    if (a !== null && b !== null && a !== b) {
      differing.push(field);
    }
  }
  return differing;
}

/**
 * Join a Falcon fleet to another source's, and report what they disagree about.
 *
 * @param hosts every host this atlas holds
 * @param devices the other source's devices
 * @returns the matches, both one-sided sets, and the hosts that carried no join key at all
 */
export function reconcileFleets({
  hosts,
  devices,
}: {
  hosts: readonly CrowdstrikeHost[];
  devices: readonly ForeignDevice[];
}): FleetReconciliation {
  const index = indexForeign({ devices });
  const matched: FleetMatch[] = [];
  const onlyInCrowdstrike: string[] = [];
  const unjoinable: string[] = [];
  const claimed = new Set<string>();

  for (const host of hosts) {
    const keys = joinKeysOf({ record: host });
    if (keys.length === 0) {
      unjoinable.push(host.providerId);
      continue;
    }
    const hit = keys.flatMap((key) => {
      const device = index.get(`${key.key}:${key.value}`);
      return device === undefined ? [] : [{ device, key: key.key }];
    })[0];
    if (hit === undefined) {
      onlyInCrowdstrike.push(host.providerId);
      continue;
    }
    claimed.add(hit.device.providerId);
    matched.push({
      assignedTo: hit.device.assignedTo,
      crowdstrikeProviderId: host.providerId,
      disagreements: fleetDisagreements({ device: hit.device, host }),
      foreignProviderId: hit.device.providerId,
      joinedOn: hit.key,
      lastObservedLogin: host.lastLoginAccount,
    });
  }

  return {
    matched: matched.toSorted((left, right) => left.crowdstrikeProviderId.localeCompare(right.crowdstrikeProviderId)),
    onlyInCrowdstrike: onlyInCrowdstrike.toSorted(),
    onlyInForeign: devices
      .filter((device) => !claimed.has(device.providerId))
      .map((device) => device.providerId)
      .toSorted(),
    unjoinable: unjoinable.toSorted(),
  };
}

/**
 * One endpoint the console calls that this installation's own credential cannot reach.
 *
 * @internal
 */
export interface SurfaceDivergence {
  readonly method: string;
  readonly pathShape: string;
  readonly observedOnPages: readonly string[];
}

/**
 * Which endpoints the console asks for that the API surface has no admitted call for.
 *
 * This is the api-versus-browser disagreement that matters on this platform, and it is a LEAD rather than a
 * capability: it says Falcon HOLDS the data behind that endpoint, never that this installation may ask for
 * it. The console reaches its own `/api2/*` surface with a bearer the page holds in memory, which this
 * atlas deliberately never obtains — so an endpoint listed here is a thing to go and ask CrowdStrike about,
 * not a thing to go and call.
 *
 * @param consoleRequests every endpoint the walk recorded the console calling
 * @param admittedPaths the paths the closed API inventory allows, as `inventory.ts` spells them
 * @returns the endpoints the console reaches and the API surface does not, sorted
 */
export function divergentSurfaces({
  consoleRequests,
  admittedPaths,
}: {
  consoleRequests: readonly { method: string; pathShape: string; observedOnPages: readonly string[] }[];
  admittedPaths: readonly string[];
}): readonly SurfaceDivergence[] {
  const admitted = new Set(admittedPaths);
  return consoleRequests
    .filter((request) => !admitted.has(request.pathShape.replace(/^\/api2/u, "")))
    .map((request) => ({
      method: request.method,
      observedOnPages: [...request.observedOnPages].toSorted(),
      pathShape: request.pathShape,
    }))
    .toSorted((left, right) => left.pathShape.localeCompare(right.pathShape));
}
