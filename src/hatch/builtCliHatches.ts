/**
 * The escape-hatch row for the BUILT CLI — any verb run from a build that no longer describes the source
 * beside it.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position. Add a row for a
 * new built-CLI refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on the built CLI's freshness, in register order. */
export const BUILT_CLI_HATCHES = [
  {
    caught:
      "the built CLI in this checkout no longer describes the source beside it, so a verdict it gives is about code nobody is editing",
    command: "slopweaver <any verb>",
    exceptions: [
      "reproducing a defect that only the older build shows, deliberately and knowing the source has moved",
      "the source tree is mid-rebase and the built CLI is the only working copy of the verb being run",
    ],
    id: "stale-build",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_STALE_BUILD" },
    lane: "ambient",
    reader: "src/builtCli/guard.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
