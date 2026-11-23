/**
 * The `codex-reset-failed` declaration — the one floating note the fleet's Codex reset claim raises, and only when
 * the claim failed (`./codexResetFailed.ts`), one note for every plan whose claim failed. A notice: nothing waits on
 * the owner, since the claim is the fleet's to make and the plan comes back by itself at its window's reset. Its own module because the wording is the whole of it,
 * and `./registry.ts` lists it in its place in `MONITORS`.
 */
import { fitLine } from "../hand/push/notice.js";
import { UNBLOCKS_CAP, WHAT_CAP } from "../hand/step.js";

import type { MonitorDefinition } from "./registry.js";

/** `codex-reset-failed`: one floating notice naming every Codex plan whose newest measured reset claim failed. */
export const CODEX_RESET_FAILED: MonitorDefinition = {
  blurb: "The fleet claimed a Codex usage-limit reset and the plan is still at its limit — a note, on no queue.",
  floats: true,
  id: "codex-reset-failed",
  notice: {
    unaddressed:
      "nothing waits on you — the plan comes back at its own reset, and this note goes then or when a later claim refills it",
  },
  plainWhat: "A Codex reset claim failed — the plans and why are below",
  prefix: "reset",
  resolves: "the plan's next claim refills it, or the window the failed claim was spent on resets by itself",
  source: "$SLOPWEAVER_HOME's codex reset claims journal — each claim's intent, answer, and the store before and after",
  unblocks: ({ subject }) => fitLine({ cap: UNBLOCKS_CAP, text: subject.label.replaceAll(/\s+/g, " ") }),
  what: ({ subject }) =>
    fitLine({ cap: WHAT_CAP, text: `A Codex reset claim failed on ${subject.id} — still at its limit` }),
};
