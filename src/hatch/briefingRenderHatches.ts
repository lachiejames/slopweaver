/**
 * The escape-hatch rows for `slopweaver briefing check` and `briefing render` — a card's framing, stale
 * cards and a stale snapshot.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position. Add a row for a
 * new briefing refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on the briefing check and render verbs, in register order. */
export const BRIEFING_RENDER_HATCHES = [
  {
    caught:
      "a react-now card uses a fleet word it never explains, asks the owner something doctrine already settles or " +
      "the owner cannot pick where it sits, or carries no age at all",
    command: "slopweaver briefing check",
    exceptions: [
      "you are checking a page rendered before these rules landed, which carries no age line on any card",
      "the page is an archive you are computing a correction against rather than one you are about to publish",
    ],
    id: "card-framing",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_CARD_FRAMING" },
    // AMBIENT, and the `escape-hatch` gate is what says so: this lifts a READ of a page that already exists,
    // and sends nothing. `briefing render`, the door that publishes, never honours it — see
    // `../cli/commands/briefing/renderRun.ts`.
    lane: "ambient",
    reader: "src/briefing/fleetJargon.ts",
    standing: "ruled",
  },
  {
    caught: "the briefing cites a card whose underlying state has moved since it was written",
    command: "slopweaver briefing render",
    exceptions: [
      "you are re-rendering a historical briefing on purpose",
      "the staleness is in a field the card does not display",
    ],
    id: "stale-cards",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/cli/prPremiseDoor.ts",
    standing: "ruled",
  },
  {
    caught:
      "a half the page is built on — the owner's list, or the index of pages open on the owner — was taken more than ninety minutes before this render, so the page would carry a day-old section under a current-looking header. Measured: the publish chain stopped regenerating the list after pass 185 and by pass 295 it was fifteen hours old",
    command: "slopweaver briefing render",
    exceptions: [
      "you are re-rendering a historical page on purpose, and its age is the point",
      "the snapshot is a fixture with a frozen clock, so its instant is deliberately not now",
    ],
    id: "stale-snapshot",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/cli/staleSnapshotDoor.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
