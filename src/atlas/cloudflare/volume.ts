/**
 * Which Cloudflare families are highly voluminous, under the owner's volume ruling.
 *
 * ## Nothing here is shape-indexed, and that is a RULING rather than an omission
 *
 * This atlas's largest kinds are time-series observations on `docs/atlas-intent/06-holdings.md`'s
 * criterion, and every one of them stays as rows. The reason is on record and is the reason this file says
 * so out loud instead of quietly declaring `shape-index` verdicts that would read as diligence.
 *
 * `inventory.ts` carries the measurement table, taken against the live account, and
 * `model.ts` carries what the owner did with it: three grounds had been used to hold these
 * kinds out of the atlas, and the owner REJECTED all three — including that a kind is a
 * time series rather than configuration (`access-authentication-log`, `dex-test`, `dex-fleet-status`).
 * The bound is volume, and the owner's example of a qualifying volume is a terabyte on this machine; the
 * largest family here was measured over the provider's WHOLE 7-day retention, with the `establishedBy`
 * command its verdict below carries, and fell nowhere near it.
 *
 * So the two rulings agree rather than collide: highly voluminous data is catalogued as a shape,
 * and these families measure nowhere near that. Re-declaring them `shape-index` on the
 * observation criterion alone would re-litigate a ruling that has a measurement against it, which is why
 * `bounded-observation` exists in `kit/volume.ts` — an atlas must be able to say "these are observations,
 * the provider bounds them, and here is the figure" without either lying or dropping the family.
 *
 * ## What is declared, and why the two arms differ
 *
 * Only the kinds over the row ceiling need a verdict, and each is declared with the command that
 * re-measures it, so a family that grows past its bound is visible as a changed number
 * rather than as silence.
 *
 * `access-authentication-log` is the family `kit/volume.ts` names as the case `bounded-observation` was built
 * for, and its PROVIDER bound is only half proven: the authentication-event stream turned
 * over completely between two generations, while the SCIM update stream beside it in the same kind has
 * shown no roll-off yet. `audit-log` is bounded by this atlas's own 30-day read rather than by the provider.
 * No observation family's STORED file is bounded by its window — the merge keeps every rolled-off row as
 * stale — so a stored file's growth is visible only against the magnitude its entry was judged at, and
 * `audit-log` crossed the ceiling on exactly that accretion.
 */
import type { AtlasVolumeDeclaration, AtlasVolumeVerdict } from "../kit/volume.js";
import type { CloudflareKind } from "./model.js";

/** Every Cloudflare family over the row ceiling, and what this atlas decided about it. */
const CLOUDFLARE_VOLUME_VERDICTS: readonly AtlasVolumeVerdict<CloudflareKind>[] = [
  {
    because:
      "one Digital Experience Monitoring sample per device per collection — battery, CPU, disk throughput, colo and connection type, each stamped with when it was taken. These are observations by §6's criterion, and the owner ruled that being a time series is NOT a ground to hold them out: they are bounded by Cloudflare's own retention and were measured against it",
    boundedBy:
      "Cloudflare's 7-day DEX retention — the provider discards a sample older than that, so what a sync READS cannot grow past one week of the fleet. The STORED kind file is not bounded by it: the merge keeps every sample that leaves the window as a stale row (`merge.ts`), so the file grows with the clock and the magnitude below is the number to re-measure against",
    disposition: "bounded-observation",
    establishedBy: "slopweaver atlas cloudflare read --kind dex-fleet-status --json | jq '.page.matched'",
    kind: "dex-fleet-status",
    magnitude:
      "the live matched-row count `atlas cloudflare read` reports for the kind in the generation standing on this install",
  },
  {
    because:
      "one row per WARP device enrolment, carrying the device, its public key, its tunnel type and when it was created and last seen. An enrolment is something a device DID rather than something the platform emitted about it, and the set is exhaustively enumerable — but it accretes with fleet churn, including ephemeral CI runners, which is why it is judged rather than left under the ceiling's silence",
    disposition: "bulk-entity",
    judgedAtRows: 10_339,
    kind: "device-registration",
  },
  {
    because:
      "one row per Access authentication event and one per SCIM update pushed by an identity provider — a login, a group-membership PATCH, each stamped with the instant it was logged and identified by that instant plus the provider's own ids. These are observations by §6's criterion, and the owner ruled that being a time series is NOT a ground to hold them out; both streams share the kind, told apart by the source operation each row was read from",
    boundedBy:
      "the PROVIDER side only, and only half of it: Cloudflare's Access log retention bounds the live authentication-event stream, which turned over completely between two generations. NOT proven for the SCIM update stream: its oldest row was unchanged across those same generations, and it grows with no roll-off seen yet — an observed growth, not a provider guarantee. The STORED kind file is not bounded by either: the merge keeps every row that leaves the provider window as a stale row (`merge.ts`), so rolled-off authentication events accrete with every sync, and stale rows include one-time residue of an earlier row identity. So this verdict admits the family the owner ruled in; it does not claim the file stays small, and the magnitude below is the number to re-measure against",
    disposition: "bounded-observation",
    establishedBy:
      "jq -r 'select(.source) | \"\\(.source.operation) \\(.state)\"' ~/.slopweaver/atlas/cloudflare/access-authentication-log.jsonl | sort | uniq -c",
    kind: "access-authentication-log",
    magnitude:
      "the live row tally per source operation (access-scim-updates-list, access-authentication-events-list) and state (observed / stale) in the kind file standing on this install",
  },
  {
    because:
      "one row per Audit Logs v2 entry — an actor changing a resource in the account, stamped with the instant Cloudflare logged it and identified by Cloudflare's own entry id. These are observations by §6's criterion, and the owner's ruling is that a time series is not a ground to hold one out; `readers/auditLog.ts` carries the owner's own choice to keep the last 30 days of them rather than none",
    boundedBy:
      "the READ, not the provider: `readers/auditLog.ts` asks for the last 30 days only, the owner's pick over the 18-month documented retention, and the busiest 30-day period measured live sat under the row ceiling. The STORED kind file is not bounded by it: the merge keeps every entry that leaves the window as a stale row (`merge.ts`), which is what carried one sync past the ceiling with no verdict — so this verdict admits the family and the magnitude below is the number to re-measure against",
    disposition: "bounded-observation",
    establishedBy: "jq -r 'select(.source) | .state' ~/.slopweaver/atlas/cloudflare/audit-log.jsonl | sort | uniq -c",
    kind: "audit-log",
    magnitude: "the live row tally per state (observed / stale) in the kind file standing on this install",
  },
];

/** What this atlas has decided about the volume of every family it holds. */
export const CLOUDFLARE_KIND_VOLUMES: AtlasVolumeDeclaration<CloudflareKind> = {
  verdicts: CLOUDFLARE_VOLUME_VERDICTS,
};
