/**
 * The `talk` noun's CALL-RECORD diagnostics, spread into `./talk.ts` — `cut-ins`, where a progress line cut into an
 * answer the voice was giving, and `fidelity`, where a summary on a call lost a claim its source held. Both read the stored calls and write nothing. Their own module, like `./talkFiles.ts`, so the noun's
 * manifest stays under the ratchet.
 */
import { TALK_CUT_INS_USAGE, TALK_FIDELITY_USAGE } from "../commands/talk/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

const talkCutInsMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver talk cut-ins --since 14d --json",
  parseRejectIsIoFree: true,
  summary:
    "Every time what reads as the console's own progress line cut into an answer the voice was already giving, oldest first, each anchored to its call turn and the Codex turn whose progress line it most likely was",
  usage: TALK_CUT_INS_USAGE,
} as const;

const talkFidelityMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver talk fidelity --call <call-id>",
  parseRejectIsIoFree: true,
  summary:
    "Where a summary on a call lost its source's claims — the answer against the tool answers its turn read, and what the voice said against that answer — each finding by kind and anchored to its message; --words reads the older word-overlap candidates instead",
  usage: TALK_FIDELITY_USAGE,
} as const;

const loadCutIns = () => import("../commands/talk/cutInsRun.js").then((m) => m.talkCutInsCommand);
const loadFidelity = () => import("../commands/talk/fidelityRun.js").then((m) => m.talkFidelityCommand);

/** `talk cut-ins` and `talk fidelity`, spread into the noun's manifest. */
export const talkCallReadsManifest: Readonly<Record<string, VerbManifestEntry>> = {
  "cut-ins": lazy({ load: loadCutIns, meta: talkCutInsMeta }),
  fidelity: lazy({ load: loadFidelity, meta: talkFidelityMeta }),
};
