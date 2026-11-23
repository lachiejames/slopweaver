/**
 * The escape-hatch rows for where an outbound write lands and what an assistant answer may assert — a
 * retired Linear team, uncited controls and unmeasured figures.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position. Add a row for a
 * new delivery-target or answer-claim refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on an outbound write's target and an answer's claims, in register order. */
export const OUTBOUND_DELIVERY_HATCHES = [
  {
    caught:
      "the write files into a Linear team this install lists in linear-retired-teams.json, a team the owner has left, so the work lands where nobody the owner works with triages it",
    command: "slopweaver linear issue|project",
    exceptions: [
      "the owner asked in so many words for this issue or project to land in that team",
      "that team's own people asked for the ticket there and the owner approved filing it on their behalf",
    ],
    id: "retired-linear-team",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/outbound/linear/retiredTeams.ts",
    standing: "proposed",
  },
  {
    caught: "the answer states a control or claim with no citation behind it",
    command: "composing an assistant answer",
    exceptions: [
      "the claim is the run's own direct observation, stated as such",
      "the citation is a screenshot attached to the same message",
    ],
    id: "uncited-controls",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/outbound/assistant/citedAndShown.ts",
    standing: "ruled",
  },
  {
    caught:
      "the answer asserts a figure — a count, a proportion — with no measurement behind it: nothing naming the command that produces it again, or when that command ran",
    command: "composing an assistant answer",
    exceptions: [
      "the figure is the asker's own number, quoted back rather than measured by this turn",
      "the figure came from a person or a page this install has no verb for, and the answer already names that blind spot",
    ],
    id: "unmeasured-figures",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/outbound/assistant/measuredFigures.ts",
    // The rule stands as doctrine, off a recorded question that carried the composer cost
    // (a median of 2 entries over 180 real reviewed answers, 39 of them owing nothing, worst 23) against the
    // naive every-digit reading's median of 20. The exception list and the required `takenAtIso` it defends
    // are ruled with it.
    standing: "ruled",
  },
] as const satisfies readonly EscapeHatch[];
