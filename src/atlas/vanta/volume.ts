/**
 * Which Vanta families are highly voluminous, under an owner ruling.
 *
 * ## Integration resources are an INVENTORY, and the owner chose to hold it whole
 *
 * `integration-resource` is the one Vanta family over the row ceiling. A reader matching on the count alone
 * would shape-index it, and the criterion in `docs/atlas-intent/06-holdings.md` says otherwise: a row is a
 * cloud role, a repository, an account or a device an integration EXPOSES — something somebody created,
 * identified by the provider's own resource id rather than by an instant, and enumerable to the end of
 * paging. Nothing is emitted per collection cycle, so the family tracks the estate rather than the clock.
 *
 * The owner's own ruling on this family is to hold it whole, every resource kind
 * (option A).
 */
import type { AtlasVolumeDeclaration, AtlasVolumeVerdict } from "../kit/volume.js";
import type { VantaKind } from "./model.js";

/** Every Vanta family judged under §6, and what this atlas decided about it. */
const VANTA_VOLUME_VERDICTS: readonly AtlasVolumeVerdict<VantaKind>[] = [
  {
    because:
      "every resource each connected integration exposes to Vanta — a cloud role, a repository, an account, a device — with its owner, description and audit scope. A resource is configuration somebody created and is keyed by its own id, so the family tracks the size of the estate rather than growing with the clock, and the owner ruled to hold it whole. Judged at the generation's row tally across every resource kind on every connected integration, the count `slopweaver atlas vanta sync` refused to publish undeclared",
    disposition: "bulk-entity",
    judgedAtRows: 33_361,
    kind: "integration-resource",
  },
];

/** What this atlas has decided about the volume of every family it holds. */
export const VANTA_KIND_VOLUMES: AtlasVolumeDeclaration<VantaKind> = {
  verdicts: VANTA_VOLUME_VERDICTS,
};
