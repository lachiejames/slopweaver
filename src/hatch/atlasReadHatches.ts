/**
 * The escape-hatch row for `slopweaver atlas <platform> read` — a zero whose evidence boundary never
 * measured one.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position, directly after
 * the Codex pass rows. Add a row for a new atlas-read refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on an atlas read, in register order. */
export const ATLAS_READ_HATCHES = [
  {
    caught:
      "no stored record matched and the evidence boundary of a selected kind cannot establish that a zero was ever measured — the coverage is unavailable, never acquired, permission-blocked or contradicted by the generation, so answering zero would be indistinguishable from an organisation that holds none",
    command: "slopweaver atlas <platform> read",
    exceptions: [
      "you are asking what this atlas STORES rather than what the provider holds, and the qualification is what you wanted",
      "the refusal names a kind you did not mean to select and narrowing --kind is the wrong fix because you want the whole list",
    ],
    id: "atlas-read-unproven-empty",
    key: { kind: "command", incantation: "slopweaver atlas <platform> read --accept-unproven-empty" },
    lane: "ambient",
    reader: "src/cli/commands/atlas/readCore.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
