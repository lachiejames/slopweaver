/*
 * What the drip-core test files share: an empty mention set, one fresh mention resolution, the drip artifact
 * built from plain texts, and the as-me post options a plan is built over. Plain values only — no filesystem,
 * no clock, no home. It moved here when the drip-core test file was split by behaviour.
 */
import type { SlackDripOptions } from "../../../../../../cli/commands/slack/core.js";
import type { DripArtifact } from "../../../../../../outbound/artifact/types.js";
import type { MentionResolution } from "../../../../../../outbound/slack/mentionIndex.js";
import type { ResolvedMentions } from "../../../../../../outbound/slack/render.js";

/** No person and no group resolved, so a rendered message carries its runs as written. */
export const NO_MENTIONS: ResolvedMentions = { groups: new Map(), people: new Map() };

/** A fresh roster with nothing held and nothing resolved, the resolution a dry run or a report reads. */
export const RESOLUTION: MentionResolution = {
  groupAddresses: new Map(),
  heldRequested: [],
  memberLookups: new Map(),
  resolved: new Map(),
  roster: { addressableKeys: 3, collisions: [], derivedPeople: 2, freshness: { kind: "fresh" }, heldPeople: 0 },
};

/**
 * A drip artifact of one plain-text message per text.
 *
 * @returns one message per input text, each a single text run, in input order
 */
export function dripArtifact({ texts }: { texts: readonly string[] }): DripArtifact {
  return { kind: "drip", messages: texts.map((text) => ({ runs: [{ text, type: "text" as const }] })) };
}

/**
 * The parsed as-me post a plan is built over, into channel `C1`.
 *
 * @returns an as-me post whose form source serialises the drip artifact of these texts
 */
export function options({
  texts,
  shape = "top-level",
  media = [],
}: {
  texts: readonly string[];
  shape?: "top-level" | "thread";
  media?: readonly string[];
}): SlackDripOptions {
  return {
    actor: "me",
    channel: "C1",
    dryRun: false,
    home: "/home",
    json: false,
    media,
    resendUnconfirmed: false,
    shape,
    source: { json: JSON.stringify(dripArtifact({ texts })), kind: "form" },
    verb: "post",
  };
}
