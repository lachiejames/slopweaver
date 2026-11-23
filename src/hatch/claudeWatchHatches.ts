/**
 * The escape-hatch row for `slopweaver claude watch`'s admission.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position. Add a row for a
 * new `claude watch` refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on `claude watch`'s admission, in register order. */
export const CLAUDE_WATCH_HATCHES = [
  {
    caught:
      "another `claude watch` is already running here, or the process table could not be read to rule one out — every watch rewrites the one keep-alive record and refreshes each store in place, so a second beside a live one doubles the credential writers and makes the gauge wrong",
    command: "slopweaver claude watch",
    exceptions: [
      "the running watch is about to be retired — a seat handing over, or one on a stale checkout being interrupted — and this one should take over the moment it exits, which is what --wait does",
      "the process table was unreadable for a moment and a --wait start will simply re-check it",
    ],
    id: "claude-watch-admission",
    key: { kind: "command", incantation: "slopweaver claude watch --wait" },
    lane: "ambient",
    reader: "src/cli/commands/claude/watchAdmission.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
