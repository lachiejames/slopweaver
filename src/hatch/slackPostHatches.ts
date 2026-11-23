/**
 * The escape-hatch rows for `slopweaver slack post`'s own gates — the wall of consecutive messages, the
 * untagged chase, the two high-stakes channel rails, and a draft a channel's own steer would reshape.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position. Add a row for a
 * new `slack post` gate HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on `slopweaver slack post`'s own gates, in register order. */
export const SLACK_POST_HATCHES = [
  {
    caught:
      "the message would be the sixth consecutive one from this identity, and a wall of text is a message the reader will not read (rule 7)",
    command: "slopweaver slack post",
    exceptions: [
      "the messages are separate threads rather than a drip into one",
      "the owner asked for exactly this sequence in the ask you are executing",
    ],
    id: "wall",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/outbound/slack/wallGate.ts",
    standing: "ruled",
  },
  {
    caught:
      "the message reads as a chase but carries no resolved `<@U…>` mention, and an untagged chase lands in nobody's activity feed",
    command: "slopweaver slack post --as me",
    exceptions: [
      "the person is already live in the thread and tagging them again would be the rude thing",
      "the chase is a DM to that person, where a mention adds nothing",
    ],
    id: "untagged-bump",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/outbound/slack/asMeBumpGate.ts",
    standing: "ruled",
  },
  {
    caught:
      "the channel is one profile.json names high-stakes, and a fleet top-level post there must carry the defensibility block the `finding` form enforces (untracked, impact with blast radius, evidence, options, no earlier thread) — a post in that channel has to be defensible",
    command: "slopweaver slack post",
    exceptions: [
      "the owner approved this exact post for this channel on a card, and it cannot take the finding form",
      "the owner asked in so many words for this message to go to this channel",
    ],
    id: "high-stakes-undefended",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/outbound/slack/highStakesChannel.ts",
    standing: "proposed",
  },
  {
    caught:
      "the fleet already made a top-level post in this high-stakes channel inside the last 24 hours, or the channel's history could not be read to say it did not — several of our posts in a row there is noise the owner does not want",
    command: "slopweaver slack post",
    exceptions: [
      "the owner approved this second post for this channel today, on a card or in their own words",
      "the earlier post was the owner's own hand, not the fleet's, and they asked for this one",
    ],
    id: "high-stakes-second-post",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/outbound/slack/highStakesChannel.ts",
    standing: "proposed",
  },
  {
    caught:
      "the owner named another channel for this draft or a row it re-cuts (a `steered` event on the register) and it still targets a channel they did not name — measured: a draft moved to the security channel went out to the programme channel it was parked for, in public",
    command: "slopweaver slack post|reply --draft",
    exceptions: [
      "the owner took the steer back in words the register does not hold, and you have read them at their anchor",
      "the steer was recorded on the wrong draft because the card on screen was not the one the owner meant, and you have read their words to say so",
    ],
    id: "channel-steered-draft",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/outbound/slack/draftSteerGate.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
