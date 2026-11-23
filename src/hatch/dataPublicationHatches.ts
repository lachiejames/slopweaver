/**
 * The escape-hatch rows for what a capture or sync PUBLISHES into the corpus or an atlas — large files, an
 * atlas sync that would lose evidence, and one whose row volume is out of line.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position. Add a row for a
 * new capture or sync publication refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on what a capture or atlas sync publishes, in register order. */
export const DATA_PUBLICATION_HATCHES = [
  {
    caught: "the file is over the ingest size bound, and one oversized record can blow the whole corpus read",
    command: "slopweaver refresh / slice capture",
    exceptions: ["the file is the actual subject of the ask and its size is the finding"],
    id: "large-files",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_LARGE_FILES" },
    lane: "ambient",
    reader: "src/corpus/self/skips.ts",
    standing: "ruled",
  },
  {
    caught:
      "the publish would empty a kind the atlas already holds, or a FAILED run would publish less evidence than the store has — a sync reconciles local state with remote, it does not erase it",
    command: "slopweaver atlas <platform> sync",
    exceptions: [
      "the provider was independently checked and genuinely holds no remaining entities of that kind",
      "a reviewed schema migration deliberately retires that kind in favour of a successor",
    ],
    id: "atlas-evidence-loss",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_ATLAS_EVIDENCE_LOSS" },
    lane: "ambient",
    reader: "src/atlas/kit/publish.ts",
    standing: "proposed",
  },
  {
    caught:
      "the publish would store highly voluminous data as ROWS — a kind this atlas declares shape-indexed carrying entities, or a kind over the row ceiling that has never been judged against docs/atlas-intent/06-holdings.md. An atlas holds everything reachable EXCEPT highly voluminous data, which is catalogued as a SHAPE",
    command: "slopweaver atlas <platform> sync",
    exceptions: [
      "a one-off local capture of a shape-indexed family that a session is about to WEIGH, so the measurement that closes its `unmeasured` basis can be taken from real records",
      "a family whose verdict is being changed in the same change, where the generation is written before the declaration it will satisfy",
    ],
    id: "atlas-row-volume",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_ATLAS_ROW_VOLUME" },
    lane: "ambient",
    reader: "src/atlas/kit/volume.ts",
    standing: "ruled",
  },
] as const satisfies readonly EscapeHatch[];
