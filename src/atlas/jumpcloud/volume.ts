/**
 * Which JumpCloud families are highly voluminous, and which are large configuration that stays.
 *
 * ## The ruling this answers, and the file it was said about
 *
 * Owner ruling: an atlas holds everything reachable EXCEPT highly voluminous data, which
 * is catalogued as a SHAPE and never stored a row at a time — and the owner named this atlas's own per-device
 * telemetry as the thing that should not enter it as rows. MEASURED on one install:
 * `~/.slopweaver/atlas/jumpcloud/systeminsights.jsonl` held **every collected table row as an entity row**,
 * its coverage cell reading `state: "synced"` beside a `read <n> systeminsights record(s)` reason. Re-derive the
 * per-operation breakdown, which is the live tally each `magnitude` below names:
 *
 * ```bash
 * grep -o '"endpoint":"[^"]*"' ~/.slopweaver/atlas/jumpcloud/<kind>.jsonl | sort | uniq -c | sort -rn
 * ```
 *
 * ## The criterion, and how it cuts through THIS platform
 *
 * `docs/atlas-intent/06-holdings.md`: a family is voluminous when its records are time-series OBSERVATIONS — emitted
 * by the platform rather than created by a person, unbounded, growing with the clock, identified by an
 * INSTANT rather than by a name somebody chose. Configuration is the complement.
 *
 * JumpCloud is the sharpest case in this tree for §6's insistence that the rule is applied per OPERATION,
 * because two of its kinds hold both halves in one file:
 *
 * - **`policies`** holds the policies an administrator authored — configuration, and the answer to this
 *   atlas's own question — beside the `v2-policyresults-list` rows, each one a per-device report of what
 *   happened at a `reportedAt` instant. A whole-kind verdict would have to drop the policies to drop the
 *   telemetry.
 * - **`assets`** holds the device assets beside `v2-list-device-asset-history` rows, which are a time
 *   series by their own name.
 *
 * ## The graph traversals are CONFIGURATION, and that is the interesting call
 *
 * `systems` holds a row per device-to-person and device-to-group association rather than one per system, and
 * a reader who stopped at the row count would shape-index it. Almost all of those rows are `v2-graph-system-traverse-user` and its siblings: the
 * ASSOCIATION between a device and the people who may use it. Nobody emitted them at an instant — they are
 * what an administrator configured, they are exhaustively enumerable, and "who holds each device" is
 * literally the question this atlas declares it answers. Same for `usergroups` membership, `applications`
 * user traversal, `softwareapps` system traversal and the `saas-management` account rows. They are declared
 * `bulk-entity` with the count they were judged at, rather than left to the row ceiling's silence, because
 * the ceiling cannot tell a large inventory from a stream and the whole point of the declaration is that a
 * person did.
 */
import { isRecord } from "../../lib/parsers.js";
import type { AtlasVolumeDeclaration, AtlasVolumeVerdict } from "../kit/volume.js";
import type { JumpcloudKind } from "./model.js";

/**
 * Read which operation produced one published row.
 *
 * `syncEntities.ts`'s `storedProviderId` builds every id as `<operation>#<own>` for a root collection and
 * `<operation>:<endpoint>#<own>` for a bound one, and an operation name is the kebab-case key from
 * `generated/surfaces.ts`, which contains neither `:` nor `#`. So the first of either character ends the
 * operation, and a row whose provider id carries neither is one this reader cannot attribute — reported as
 * `null` rather than as the whole string, because a wrong attribution is worse than none.
 *
 * The kit hands the row over as `unknown` — `kit/volume.ts`'s {@link AtlasRowOperation} says why — so this
 * guards rather than asserts. A row that does not carry a string provider id is one this atlas does not
 * recognise, and `null` is the only honest answer to that.
 *
 * @param row one published entity, as the kit read it
 * @returns the operation's own name, or `null` when the row carries no provider id naming one
 */
export function jumpcloudRowOperation({ row }: { row: unknown }): string | null {
  if (!isRecord(row)) {
    return null;
  }
  const providerId = row["providerId"];
  if (typeof providerId !== "string") {
    return null;
  }
  const end = providerId.search(/[:#]/);
  if (end <= 0) {
    return null;
  }
  return providerId.slice(0, end);
}

/** Every JumpCloud family judged under §6, and what its atlas decided. */
const JUMPCLOUD_VOLUME_VERDICTS: readonly AtlasVolumeVerdict<JumpcloudKind>[] = [
  {
    because:
      "per-device osquery observations — installed applications, certificates, browser extensions, disk encryption, mounts, uptime and forty-nine more tables — collected by the agent on a schedule and stamped with their own `collection_time`. Nobody authored a row; the fleet emits them, and every collection cycle emits a fresh set, so the family grows with the clock and never converges on a list",
    disposition: "shape-index",
    kind: "systeminsights",
    volume: {
      basis: "measured",
      establishedBy:
        'grep -o \'"endpoint":"[^"]*"\' ~/.slopweaver/atlas/jumpcloud/systeminsights.jsonl | sort | uniq -c | sort -rn',
      magnitude:
        "the live per-operation row tally in the published `systeminsights.jsonl`, one count per `v2-systeminsights-list-*` operation. This is the file the owner named",
      unboundedBecause:
        "the agent re-collects every table on every device on a schedule, so the row count is a function of fleet size times table count times elapsed time and has no ceiling",
    },
  },
  {
    because:
      "one row per device per policy application, each carrying the `reportedAt` instant JumpCloud stamped when the agent reported the outcome. A policy is configuration; what happened to it on a device at a moment is an observation",
    disposition: "shape-index",
    kind: "policyresults",
    volume: {
      basis: "measured",
      establishedBy: "wc -l ~/.slopweaver/atlas/jumpcloud/policyresults.jsonl",
      magnitude: "the live row count of the published `policyresults.jsonl`",
      unboundedBecause:
        "every policy re-application on every device reports again, so the family grows with fleet size times policy count times time",
    },
  },
  {
    because:
      "the same per-device policy-application reports as the `policyresults` kind, reached through each policy's own `/policyresults` sub-collection and filed under `policies`. The policies an administrator authored are the configuration this kind exists to hold; these are not",
    disposition: "shape-index",
    kind: "policies",
    operation: "v2-policyresults-list",
    volume: {
      basis: "measured",
      establishedBy:
        "grep -c 'v2-policyresults-list' ~/.slopweaver/atlas/jumpcloud/policies.jsonl — against `wc -l` of the same file for the entity half",
      magnitude:
        "the live count of `policies.jsonl` rows that came from `v2-policyresults-list`, read against the file's whole line count",
      unboundedBecause: "identical to the `policyresults` kind — it is the same emission read by another route",
    },
  },
  {
    because:
      "a device asset's own change history: one row per recorded transition, stamped with when it happened. The device assets themselves are configuration and stay",
    disposition: "shape-index",
    kind: "assets",
    operation: "v2-list-device-asset-history",
    volume: {
      basis: "measured",
      establishedBy: "grep -c 'v2-list-device-asset-history' ~/.slopweaver/atlas/jumpcloud/assets.jsonl",
      magnitude: "the live count of `assets.jsonl` rows that came from `v2-list-device-asset-history`",
      unboundedBecause: "a history accrues an entry per change and is never compacted, so it grows with the clock",
    },
  },
  {
    because:
      "Directory Insights events — one row per authentication, administrator action or directory change, identified by the instant it happened",
    disposition: "shape-index",
    kind: "events",
    volume: {
      basis: "unmeasured",
      unboundedBecause:
        "Directory Insights emits an event per action taken across the whole directory, so the family grows with activity and has no ceiling",
      wouldBeMeasuredBy:
        "POST /insights/directory/v1/events/count over a bounded window, which returns the window's own total rather than a page",
    },
  },
  {
    because:
      "one row per command execution on one device, carrying the output and the instant it ran. The commands somebody authored are the `commands` kind and stay",
    disposition: "shape-index",
    kind: "commandresults",
    volume: {
      basis: "measured",
      establishedBy: "slopweaver atlas jumpcloud coverage --kind commandresults",
      magnitude: "the live command-result row count the `commandresults` coverage cell reports",
      unboundedBecause: "a result is emitted per command run per device and is never superseded, only added to",
    },
  },
  {
    because:
      "the device-to-person and device-to-group ASSOCIATIONS an administrator configured, read through the graph traversals, beside the systems themselves. Nothing here is emitted at an instant and the set is exhaustively enumerable — `who holds each device` is the question this atlas declares it answers, and these rows are the answer",
    disposition: "bulk-entity",
    judgedAtRows: 40_149,
    kind: "systems",
  },
  {
    because:
      "user-group membership, one row per person per group, read through the membership and members traversals. Configuration somebody set, enumerable, and the directory's whole point",
    disposition: "bulk-entity",
    judgedAtRows: 16_014,
    kind: "usergroups",
  },
  {
    because:
      "which people are entitled to which SSO application, read through the application user traversal. An entitlement is configuration, not an event",
    disposition: "bulk-entity",
    judgedAtRows: 11_614,
    kind: "applications",
  },
  {
    because:
      "which managed software packages are assigned to which devices. An assignment is configuration; the installation REPORT for one is `systeminsights`, which is shape-indexed above",
    disposition: "bulk-entity",
    judgedAtRows: 19_698,
    kind: "softwareapps",
  },
  {
    because:
      "the SaaS application catalogue and the discovered ACCOUNTS on each application. This is the organisation's SaaS inventory and nothing else in this installation holds it — the same reason `docs/atlas-intent/06-holdings.md` gives for Trelica holding entities rather than a surface map",
    disposition: "bulk-entity",
    judgedAtRows: 23_791,
    kind: "saas-management",
  },
  {
    because:
      'the policies an administrator authored and WHERE each is bound. The rows kept in `policies.jsonl` are policy-to-system bindings, per-device application statuses, policy definitions read twice (list and get), policy-to-system-group bindings and group memberships (`grep -o \'"providerId":"[^":#]*\' ~/.slopweaver/atlas/jumpcloud/policies.jsonl | sed \'s/"providerId":"//\' | grep -v policyresults | sort | uniq -c | sort -rn`); `judgedAtRows` is what a walk refused at the page cap read. A binding is configuration somebody created and a status is the CURRENT state of one, so the family is bounded by policies times devices and converges rather than growing with the clock. Its time-series half — the per-device application REPORTS — is `v2-policyresults-list`, shape-indexed by operation above',
    disposition: "bulk-entity",
    judgedAtRows: 23_372,
    kind: "policies",
  },
  {
    because:
      "the commands an administrator authored, together with the devices each is bound to. A command is a thing somebody wrote; its RESULTS are the `commandresults` kind, shape-indexed above",
    disposition: "bulk-entity",
    judgedAtRows: 5_347,
    kind: "commands",
  },
];

/** What this atlas has decided about the volume of every family it holds. */
export const JUMPCLOUD_KIND_VOLUMES: AtlasVolumeDeclaration<JumpcloudKind> = {
  operationOf: jumpcloudRowOperation,
  verdicts: JUMPCLOUD_VOLUME_VERDICTS,
};
