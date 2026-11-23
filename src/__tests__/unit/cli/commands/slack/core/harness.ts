/*
 * What the `slack post|reply` core test files share: a valid update form, one resolved mention over a healthy roster,
 * the as-bot argument list, the narrowing to the card arm, and a post plan built from a form over the test chrome.
 */
import {
  buildSlackWritePlan,
  parseSlackForm,
  type SlackCardOptions,
  type SlackWriteOptions,
  type SlackWritePlan,
} from "../../../../../../cli/commands/slack/core.js";
import { unwrap } from "../../../../../../lib/result.js";
import type { MentionResolution } from "../../../../../../outbound/slack/mentionIndex.js";
import type { SlackCardChrome } from "../../../../../../outbound/slack/types.js";

const CHROME: SlackCardChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "test-bot",
  bannerColor: "#12B5A6",
  detailLabel: "*Details*",
  metadataEventType: "test_card_v1",
};

export const VALID_FORM = JSON.stringify({
  detail: [{ runs: [{ text: "The detail.", type: "text" }], type: "paragraph" }],
  kind: "update",
  tldr: "A short lead.",
});

/** One resolved mention over a healthy roster — the shape the shell hands the reporters. */
export const MENTIONS: MentionResolution = {
  groupAddresses: new Map(),
  heldRequested: [],
  memberLookups: new Map(),
  resolved: new Map([["ada-l", { origin: "override", slackId: "U_fake_ada" }]]),
  roster: {
    addressableKeys: 12,
    collisions: [],
    derivedPeople: 9,
    freshness: { kind: "fresh" },
    heldPeople: 3,
  },
};

/**
 * The as-bot invocation every card-lane case starts from, with any further flags appended.
 *
 * @returns `--as bot --channel C1 --form <the valid form>` followed by the extra flags
 */
export function args({ extra = [] }: { extra?: readonly string[] } = {}): readonly string[] {
  return ["--as", "bot", "--channel", "C1", "--form", VALID_FORM, ...extra];
}

/**
 * Narrow a parsed invocation to the CARD arm.
 *
 * `SlackWriteOptions` is a union discriminated on `actor`, so a card-only field is not reachable without
 * saying which arm you expect. A throwing narrowing keeps the assertion falsifiable — an as-me parse
 * reaching a card assertion fails loudly instead of reading `undefined`.
 *
 * @returns the same invocation, typed as the card arm
 */
export function cardArm(options: SlackWriteOptions): SlackCardOptions {
  if (options.actor !== "bot" || "release" in options) {
    throw new Error(`expected the card arm, got a --as ${options.actor} draft release or drip`);
  }
  return options;
}

/**
 * An as-bot post plan for the given form and media, over the test chrome and no resolved mentions.
 *
 * @returns the send plan `buildSlackWritePlan` decides for that post to C1
 */
export function planFor({
  media = [],
  form = VALID_FORM,
}: { media?: readonly string[]; form?: string } = {}): SlackWritePlan {
  const { artifact, formKind } = unwrap(parseSlackForm({ json: form }));
  return buildSlackWritePlan({
    artifact,
    chrome: CHROME,
    formKind,
    mentions: { groups: new Map(), people: new Map() },
    options: {
      actor: "bot",
      allowUnresolvedOwner: false,
      channel: "C1",
      dryRun: false,
      formJson: form,
      home: "/home",
      json: false,
      media,
      resendUnconfirmed: false,
      verb: "post",
    },
  });
}
