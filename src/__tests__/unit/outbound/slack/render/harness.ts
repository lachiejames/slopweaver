/*
 * What the card renderer's test files share: the smallest valid `update` artifact, and a render call with neutral
 * chrome, fake mentions and a fixed fingerprint already bound.
 */
import type { UpdateArtifact } from "../../../../../outbound/artifact/types.js";
import { type ResolvedMentions, renderUpdateCard } from "../../../../../outbound/slack/render.js";
import type { SlackCardChrome, SlackCardPayload } from "../../../../../outbound/slack/types.js";

/** Neutral chrome. Never a real operator's bot name — this is a public repo. */
const CHROME: SlackCardChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "test-bot",
  bannerColor: "#12B5A6",
  detailLabel: "*Details*",
  metadataEventType: "test_card_v1",
};

const MENTIONS: ResolvedMentions = {
  groups: new Map([["engineers", "S_fake_engineers"]]),
  people: new Map([["ada", "U_fake_ada"]]),
};

/**
 * The smallest valid card: one paragraph of detail, which is what makes it six blocks and fold.
 *
 * @returns a fresh artifact with that paragraph and no citations, index or media
 */
export function minimalArtifact(): UpdateArtifact {
  return {
    citations: [],
    detail: [{ runs: [{ text: "The detail.", type: "text" }], type: "paragraph" }],
    index: [],
    kind: "update",
    media: [],
    tldr: "A short lead.",
  };
}

/**
 * Render a card with the neutral chrome, the fake mentions and a fixed fingerprint.
 *
 * @returns the payload `renderUpdateCard` builds for the artifact
 */
export function render({ artifact }: { artifact: UpdateArtifact }): SlackCardPayload {
  return renderUpdateCard({ artifact, artifactFingerprint: "fp-1", chrome: CHROME, mentions: MENTIONS });
}
