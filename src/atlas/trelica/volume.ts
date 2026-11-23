/**
 * Which Trelica families are highly voluminous, under an owner ruling.
 *
 * ## Devices are an INVENTORY, held whole
 *
 * `device` is the one Trelica family over the row ceiling. By the criterion in `docs/atlas-intent/06-holdings.md`
 * it is configuration: a row is one device a source (an MDM, an identity provider) reports, keyed by Trelica's own
 * record id and carrying its CURRENT assignment, status and last sync. A re-read updates the row rather than adding
 * one, so the family tracks the size of the estate — every device ever enrolled — and never grows with the clock.
 * Who holds which device is the question an offboarding check asks of it, and the owner's ruling on this atlas is
 * to hold everything.
 */
import type { AtlasVolumeDeclaration, AtlasVolumeVerdict } from "../kit/volume.js";
import type { TrelicaAtlasKind } from "./model.js";

/** Every Trelica family judged under §6, and what this atlas decided about it. */
const TRELICA_VOLUME_VERDICTS: readonly AtlasVolumeVerdict<TrelicaAtlasKind>[] = [
  {
    because:
      "every device each connected source reports to Trelica, with who it is assigned to, its status, encryption and last sync. A device is keyed by its own record id and re-read in place, so the family tracks the estate rather than the clock. Declared because `slopweaver atlas trelica sync` refused to publish the family's live row count undeclared",
    disposition: "bulk-entity",
    judgedAtRows: 11_932,
    kind: "device",
  },
];

/** What this atlas has decided about the volume of every family it holds. */
export const TRELICA_KIND_VOLUMES: AtlasVolumeDeclaration<TrelicaAtlasKind> = {
  verdicts: TRELICA_VOLUME_VERDICTS,
};
