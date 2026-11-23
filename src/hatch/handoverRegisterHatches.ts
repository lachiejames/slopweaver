/**
 * The escape-hatch rows for `handover register` — the checks that refuse a board row before it is written: one
 * whose prose names someone other than the person who posted its Slack anchor, and a finding registered from a
 * seat whose code the trunk already rewrote — and the one for the same row's other end, `handover settle --as
 * answered` on a bare pull request URL the owner's words asked proof of.
 *
 * A file rather than a section of `./registry.ts` for the reason `./codexPassHatches.ts` gives: the register
 * sheds a whole surface to a sibling, and `ESCAPE_HATCHES` spreads it back in, so there is still one register.
 * Spread at the position `stale-seat-finding` was typed at, so `./answerDoorHatches.ts`'s rows still follow it.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on `handover register`. */
export const HANDOVER_REGISTER_HATCHES = [
  {
    caught:
      "the row's prose says a person asked, tagged or posted what its Slack anchor links, and the local corpus says somebody else posted that message — the card's link would open a stranger's message under a line naming someone else",
    command: "slopweaver handover register",
    exceptions: [
      "the name is a different roster person's namesake, and the person who really posted it goes by that name too",
      "the sentence reports what someone said ABOUT the anchored message rather than who posted it",
    ],
    id: "anchor-attribution",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_ANCHOR_ATTRIBUTION" },
    lane: "ambient",
    reader: "src/cli/commands/handover/anchorAttributionGate.ts",
    standing: "proposed",
  },
  {
    caught:
      "the ask is settled answered with a bare pull request URL while the owner's words on the row ask for proof — screenshots, run links, a Datadog view — and the body read live lacks one, so the settlement would assert the ask was met without anything having looked",
    command: "slopweaver handover settle --as answered",
    exceptions: [
      "the owner has since waived the proof they asked for, in words on record a reader can find",
      "the proof lives somewhere the body links but this check does not count — a comment, a Linear issue — and you have opened it",
    ],
    id: "proof-witness",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNPROVEN_ANSWER" },
    lane: "ambient",
    reader: "src/cli/commands/handover/proofWitnessGate.ts",
    standing: "proposed",
  },
  {
    caught:
      "this seat lacks upstream commits that changed the very code paths the finding names as evidence — the defect may already be fixed, and a row registered from superseded code sends the fleet at a repository that no longer exists",
    command: "slopweaver handover register --finding",
    exceptions: [
      "the defect is in this seat’s own uncommitted work and the upstream change to that path is unrelated",
      "the finding is ABOUT the upstream commit itself, so reading the seat’s older copy is the point",
    ],
    id: "stale-seat-finding",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_STALE_SEAT_FINDING" },
    lane: "ambient",
    reader: "src/cli/commands/handover/staleEvidenceGate.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
