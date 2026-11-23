/**
 * The escape-hatch row for WHO may drive the bot — admitting, and replying to, a Slack addresser that
 * `responders.json` does not list.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position. It sits apart
 * from the answer-door rows because the policy spans BOTH halves of a turn: the listener's admission of a
 * tag and the send of the reply. Add a row for another responder-policy refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on the responder whitelist, in register order. */
export const RESPONDER_HATCHES = [
  {
    caught:
      "the addresser is not on responders.json, and admitting them lets a person nobody listed drive the bot and receive its replies — a widened whitelist is what makes prompt injection a real problem (docs/security/slack-command-boundary.md)",
    command: "a Slack tag, `turn brief|dispatch|answer` or `witness help` for an addresser off responders.json",
    exceptions: [
      "responders.json cannot be repaired first, the listener is scoped to a conversation the owner controls, and the owner wants this addresser answered now",
      "a controlled test of the admission path in an isolated conversation, where no reply carries anything sensitive",
    ],
    id: "responder-allow-open",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/live/listen/responderHatch.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
