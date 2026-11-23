/**
 * Which CrowdStrike families are highly voluminous, under the owner's volume ruling.
 *
 * ## Spotlight findings are observations that do not grow with the clock, and the filter is why
 *
 * `vulnerability` is the only family here over the row ceiling, and the temptation is to shape-index it:
 * the Datadog atlas's own `shape-index` row names _"security signals and findings"_ among the ten families
 * it covers, and a reader matching on that phrase would stop there.
 *
 * The phrase does not transfer, and reading `syncReaders.ts` is what settles it. This atlas asks Spotlight
 * for `filter: "status:'open'"` and says so in its own coverage reason — _"closed findings are deliberately
 * not read"_. So a row here is not an emission that happened once and stays forever; it is a statement of
 * the fleet's CURRENT posture, and a host that gets patched takes its row out of the set. The family churns
 * rather than accretes, and its size is fleet times installed software times open CVEs — finite, and
 * knowable, in a way Datadog's per-instant security signals are not.
 *
 * That is `bounded-observation` exactly: the records ARE observations, nobody authored them, and the
 * provider's own query bounds them. Calling it `bulk-entity` would assert somebody created a vulnerability,
 * and calling it `shape-index` would drop the answer to the question this atlas exists for.
 */
import type { AtlasVolumeDeclaration, AtlasVolumeVerdict } from "../kit/volume.js";
import type { CrowdstrikeKind } from "./model.js";

/** Every CrowdStrike family judged under §6, and what this atlas decided about it. */
const CROWDSTRIKE_VOLUME_VERDICTS: readonly AtlasVolumeVerdict<CrowdstrikeKind>[] = [
  {
    because:
      "open Spotlight findings — one row per host per CVE, carrying the base score, severity, exploit status and CISA KEV flag. Nobody authored one, so they are observations rather than configuration; what keeps them finite is that only OPEN findings are read, so a patched host's row leaves the set instead of accumulating beside its successor",
    boundedBy:
      "the reader's own `status:'open'` filter (`syncReaders.ts`), plus the fleet's installed software — this is current posture, not an append-only stream, and closed findings are deliberately never read",
    disposition: "bounded-observation",
    establishedBy: "slopweaver atlas crowdstrike read --kind vulnerability --json | jq '.page.matched'",
    kind: "vulnerability",
    magnitude:
      "the generation's open-findings tally read to the end of paging and matching the total the provider reported, and the kind file's row and byte size beside it (the file carries the envelope too); re-established by the command above, never kept here as an installation's figures",
  },
];

/** What this atlas has decided about the volume of every family it holds. */
export const CROWDSTRIKE_KIND_VOLUMES: AtlasVolumeDeclaration<CrowdstrikeKind> = {
  verdicts: CROWDSTRIKE_VOLUME_VERDICTS,
};
